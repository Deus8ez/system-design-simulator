import type { Node, Edge } from "@xyflow/react";
import type { Problem } from "@/types/problem";
import { getComponentById } from "@/data/components";
import { useCanvasStore, type ComponentNodeData } from "@/store/canvasStore";
import { useAppStore } from "@/store/appStore";
import { compileDesign } from "@/engine/compiler";

/**
 * Build canvas nodes + edges for a problem's reference solution.
 *
 * Instance matching is EXACT on componentId (never prefix-based):
 * - Each reference node becomes a unique instance, tracked per componentId in order.
 * - Edge endpoints referencing a componentId with N instances are connected
 *   round-robin by occurrence order (independent counters for source/target
 *   roles so chains like A -> B -> C stay connected through the same instance).
 */
export function buildReferenceGraph(problem: Problem): {
  nodes: Node<ComponentNodeData>[];
  edges: Edge[];
} {
  // componentId -> node ids, in declaration order
  const instancesByComponent = new Map<string, string[]>();
  const refNodes: Node<ComponentNodeData>[] = [];

  problem.referenceSolution.nodes.forEach((ref, index) => {
    const comp = getComponentById(ref.componentId);
    if (!comp) return;

    const nodeId = `${comp.id}-ref-${index}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const list = instancesByComponent.get(ref.componentId) ?? [];
    list.push(nodeId);
    instancesByComponent.set(ref.componentId, list);

    refNodes.push({
      id: nodeId,
      type: "component",
      position: { x: ref.x, y: ref.y },
      data: {
        componentId: comp.id,
        label: comp.label,
        icon: comp.icon,
        category: comp.category,
        replicas: 1,
        maxQPS: comp.maxQPS,
        latencyMs: comp.latencyMs,
        scalable: comp.scalable,
      },
    });
  });

  if (problem.id === "url-shortener") {
    const appServers = refNodes.filter((node) => node.data.componentId === "app-server");
    const gateways = refNodes.filter((node) => node.data.componentId === "api-gateway");
    const cacheId = instancesByComponent.get("cache")?.[0];
    const databaseId = instancesByComponent.get("nosql-db")?.[0];
    if (cacheId && databaseId) {
      for (const appServer of appServers) {
        appServer.data.replicas = 3;
        appServer.data.endpoints = [
          {
            id: "reference-get-short-url",
            method: "GET",
            path: "/:code",
            trafficWeight: 100,
            steps: [
              {
                id: "reference-cache-read",
                kind: "cache-read",
                targetNodeId: cacheId,
                target: "url:{code}",
                cacheHitRate: 0.9,
              },
              {
                id: "reference-url-read",
                kind: "database-read",
                targetNodeId: databaseId,
                target: "urls.shortCode",
              },
              { id: "reference-redirect-response", kind: "respond" },
            ],
          },
          {
            id: "reference-post-short-url",
            method: "POST",
            path: "/urls",
            trafficWeight: 1,
            steps: [
              {
                id: "reference-url-write",
                kind: "database-write",
                targetNodeId: databaseId,
                target: "urls.shortCode,longUrl",
              },
              {
                id: "reference-cache-invalidate",
                kind: "cache-invalidate",
                targetNodeId: cacheId,
                target: "url:{code}",
              },
              { id: "reference-create-response", kind: "respond" },
            ],
          },
        ];
      }
      for (const gateway of gateways) {
        const backend = appServers[0];
        if (!backend) continue;
        gateway.data.routes = [
          {
            id: "reference-gateway-get-short-url",
            method: "GET",
            path: "/:code",
            backendNodeId: backend.id,
            trafficWeight: 100,
          },
          {
            id: "reference-gateway-post-short-url",
            method: "POST",
            path: "/urls",
            backendNodeId: backend.id,
            trafficWeight: 1,
          },
        ];
      }
    }
    for (const database of refNodes.filter((node) => node.data.componentId === "nosql-db")) {
      database.data.tables = [
        {
          id: "reference-urls-table",
          name: "urls",
          estimatedRows: 100_000_000,
          columns: [
            { id: "reference-short-code", name: "shortCode", dataType: "string", nullable: false, primaryKey: true },
            { id: "reference-long-url", name: "longUrl", dataType: "string", nullable: false, primaryKey: false },
          ],
          indexes: [],
        },
      ];
    }
  }

  if (problem.id === "rate-limiter") {
    const appServers = refNodes.filter((node) => node.data.componentId === "app-server");
    const gateways = refNodes.filter((node) => node.data.componentId === "api-gateway");
    const caches = refNodes.filter((node) => node.data.componentId === "cache");
    const backend = appServers[0];

    for (const appServer of appServers) {
      // Keep the example's business tier above the default 10k QPS simulation load.
      appServer.data.replicas = 3;
      appServer.data.endpoints = [
        {
          id: "reference-rate-limited-resource-read",
          method: "GET",
          path: "/api/resources",
          trafficWeight: 90,
          requestFields: [
            { id: "reference-rate-limit-read-client", name: "clientId", type: "string", location: "query" },
          ],
          responseFields: [
            { id: "reference-rate-limit-read-resource", name: "resource", type: "string" },
            { id: "reference-rate-limit-read-remaining", name: "remaining", type: "number" },
          ],
          steps: [{ id: "reference-rate-limit-read-response", kind: "respond" }],
        },
        {
          id: "reference-rate-limited-resource-write",
          method: "POST",
          path: "/api/resources",
          trafficWeight: 10,
          requestFields: [
            { id: "reference-rate-limit-write-client", name: "clientId", type: "string", location: "body" },
            { id: "reference-rate-limit-write-payload", name: "payload", type: "string", location: "body" },
          ],
          responseFields: [
            { id: "reference-rate-limit-write-accepted", name: "accepted", type: "boolean" },
            { id: "reference-rate-limit-write-remaining", name: "remaining", type: "number" },
          ],
          steps: [{ id: "reference-rate-limit-write-response", kind: "respond" }],
        },
      ];
    }

    for (const gateway of gateways) {
      if (!backend) continue;
      gateway.data.routes = [
        { id: "reference-rate-limit-route-read", method: "GET", path: "/api/resources", backendNodeId: backend.id, trafficWeight: 90 },
        { id: "reference-rate-limit-route-write", method: "POST", path: "/api/resources", backendNodeId: backend.id, trafficWeight: 10 },
      ];
    }

    for (const cache of caches) {
      cache.data.cacheConfig = {
        maxMemoryMB: 512,
        defaultTtlSeconds: 60,
        evictionPolicy: "allkeys-lru",
      };
    }
  }

  if (problem.id === "notification-system") {
    const appServers = refNodes.filter((node) => node.data.componentId === "app-server");
    const gateways = refNodes.filter((node) => node.data.componentId === "api-gateway");
    const caches = refNodes.filter((node) => node.data.componentId === "cache");
    const queues = refNodes.filter((node) => node.data.componentId === "message-queue");
    const notificationServices = refNodes.filter((node) => node.data.componentId === "notification-service");
    const noSqlDatabases = refNodes.filter((node) => node.data.componentId === "nosql-db");
    const sqlDatabases = refNodes.filter((node) => node.data.componentId === "sql-db");
    const backend = appServers[0];
    const cacheId = caches[0]?.id;
    const queueId = queues[0]?.id;
    const noSqlDatabaseId = noSqlDatabases[0]?.id;
    const sqlDatabaseId = sqlDatabases[0]?.id;

    for (const appServer of appServers) {
      // Size this example for the default 10k QPS preset; the model is an estimate, not a provider SLA.
      appServer.data.replicas = 3;
      appServer.data.endpoints = [
        {
          id: "reference-notification-submit",
          method: "POST",
          path: "/notifications",
          trafficWeight: 80,
          requestFields: [
            { id: "reference-notification-user", name: "userId", type: "string", location: "body" },
            { id: "reference-notification-type", name: "notificationType", type: "string", location: "body" },
            { id: "reference-notification-priority", name: "priority", type: "string", location: "body" },
            { id: "reference-notification-payload", name: "payload", type: "string", location: "body" },
          ],
          responseFields: [
            { id: "reference-notification-id", name: "notificationId", type: "string" },
            { id: "reference-notification-accepted", name: "accepted", type: "boolean" },
          ],
          steps: [
            ...(cacheId ? [{
              id: "reference-notification-preference-cache",
              kind: "cache-read" as const,
              targetNodeId: cacheId,
              target: "user-preferences:{userId}",
              cacheHitRate: 0.85,
            }] : []),
            ...(sqlDatabaseId ? [{
              id: "reference-notification-preference-read",
              kind: "database-read" as const,
              targetNodeId: sqlDatabaseId,
              target: "user_preferences.userId,enabledChannels,optOutCategories",
            }] : []),
            ...(noSqlDatabaseId ? [{
              id: "reference-notification-record-write",
              kind: "database-write" as const,
              targetNodeId: noSqlDatabaseId,
              target: "notifications.notificationId,userId,type,priority,deliveryStatus,createdAt,updatedAt",
            }] : []),
            ...(queueId ? [{
              id: "reference-notification-publish",
              kind: "publish-event" as const,
              targetNodeId: queueId,
              target: "notifications",
            }] : []),
            { id: "reference-notification-submit-response", kind: "respond" as const },
          ],
        },
        {
          id: "reference-notification-status",
          method: "GET",
          path: "/notifications/:notificationId",
          trafficWeight: 10,
          requestFields: [
            { id: "reference-notification-status-id", name: "notificationId", type: "string", location: "path" },
          ],
          responseFields: [
            { id: "reference-notification-status-value", name: "deliveryStatus", type: "string" },
            { id: "reference-notification-status-updated", name: "updatedAt", type: "number" },
          ],
          steps: [
            ...(noSqlDatabaseId ? [{
              id: "reference-notification-status-read",
              kind: "database-read" as const,
              targetNodeId: noSqlDatabaseId,
              target: "notifications.notificationId,deliveryStatus,updatedAt",
            }] : []),
            { id: "reference-notification-status-response", kind: "respond" as const },
          ],
        },
        {
          id: "reference-notification-preferences",
          method: "GET",
          path: "/users/:userId/notification-preferences",
          trafficWeight: 10,
          requestFields: [
            { id: "reference-preferences-user", name: "userId", type: "string", location: "path" },
          ],
          responseFields: [
            { id: "reference-preferences-channels", name: "enabledChannels", type: "string" },
            { id: "reference-preferences-opt-outs", name: "optOutCategories", type: "string" },
          ],
          steps: [
            ...(cacheId ? [{
              id: "reference-preferences-cache-read",
              kind: "cache-read" as const,
              targetNodeId: cacheId,
              target: "user-preferences:{userId}",
              cacheHitRate: 0.85,
            }] : []),
            ...(sqlDatabaseId ? [{
              id: "reference-preferences-database-read",
              kind: "database-read" as const,
              targetNodeId: sqlDatabaseId,
              target: "user_preferences.userId,enabledChannels,optOutCategories",
            }] : []),
            { id: "reference-preferences-response", kind: "respond" as const },
          ],
        },
      ];
    }

    for (const gateway of gateways) {
      if (!backend) continue;
      gateway.data.routes = [
        { id: "reference-notification-route-submit", method: "POST", path: "/notifications", backendNodeId: backend.id, trafficWeight: 80 },
        { id: "reference-notification-route-status", method: "GET", path: "/notifications/:notificationId", backendNodeId: backend.id, trafficWeight: 10 },
        { id: "reference-notification-route-preferences", method: "GET", path: "/users/:userId/notification-preferences", backendNodeId: backend.id, trafficWeight: 10 },
      ];
    }

    for (const cache of caches) {
      cache.data.cacheConfig = {
        maxMemoryMB: 2048,
        defaultTtlSeconds: 300,
        evictionPolicy: "allkeys-lru",
      };
    }

    for (const queue of queues) {
      queue.data.queueDeliveryMode = "competing";
      queue.data.queueConfig = {
        topics: [{ id: "reference-notifications-topic", name: "notifications", retentionHours: 24 }],
        subscriptions: notificationServices.map((service, index) => ({
          id: `reference-notifications-worker-${index + 1}`,
          consumerNodeId: service.id,
          topicName: "notifications",
        })),
      };
    }

    for (const service of notificationServices) {
      service.data.replicas = 2;
    }

    for (const database of sqlDatabases) {
      database.data.replicas = 2;
      database.data.tables = [{
        id: "reference-user-preferences-table",
        name: "user_preferences",
        estimatedRows: 500_000_000,
        columns: [
          { id: "reference-preferences-user-id", name: "userId", dataType: "TEXT", nullable: false, primaryKey: true },
          { id: "reference-preferences-enabled-channels", name: "enabledChannels", dataType: "TEXT", nullable: false, primaryKey: false },
          { id: "reference-preferences-opt-outs", name: "optOutCategories", dataType: "TEXT", nullable: false, primaryKey: false },
          { id: "reference-preferences-updated-at", name: "updatedAt", dataType: "BIGINT", nullable: false, primaryKey: false },
        ],
        indexes: [],
      }];
    }

    for (const database of noSqlDatabases) {
      database.data.tables = [{
        id: "reference-notifications-table",
        name: "notifications",
        estimatedRows: 5_000_000_000,
        columns: [
          { id: "reference-notification-id-column", name: "notificationId", dataType: "TEXT", nullable: false, primaryKey: true },
          { id: "reference-notification-user-column", name: "userId", dataType: "TEXT", nullable: false, primaryKey: false },
          { id: "reference-notification-type-column", name: "type", dataType: "TEXT", nullable: false, primaryKey: false },
          { id: "reference-notification-priority-column", name: "priority", dataType: "TEXT", nullable: false, primaryKey: false },
          { id: "reference-notification-delivery-status-column", name: "deliveryStatus", dataType: "TEXT", nullable: false, primaryKey: false },
          { id: "reference-notification-created-at-column", name: "createdAt", dataType: "BIGINT", nullable: false, primaryKey: false },
          { id: "reference-notification-updated-at-column", name: "updatedAt", dataType: "BIGINT", nullable: false, primaryKey: false },
        ],
        indexes: [{
          id: "reference-notifications-user-created-index",
          name: "notifications_user_created_idx",
          columns: ["userId", "createdAt"],
          unique: false,
        }],
      }];
    }
  }

  if (problem.id === "music-streaming") {
    const appServers = refNodes.filter((node) => node.data.componentId === "app-server");
    const gateways = refNodes.filter((node) => node.data.componentId === "api-gateway");
    const caches = refNodes.filter((node) => node.data.componentId === "cache");
    const queues = refNodes.filter((node) => node.data.componentId === "message-queue");
    const noSqlDatabases = refNodes.filter((node) => node.data.componentId === "nosql-db");
    const backend = appServers[0];
    const cacheId = caches[0]?.id;
    const queueId = queues[0]?.id;
    const databaseId = noSqlDatabases[0]?.id;

    for (const appServer of appServers) {
      appServer.data.replicas = 3;
      appServer.data.endpoints = [
        {
          id: "reference-music-track-metadata",
          method: "GET",
          path: "/tracks/:trackId",
          trafficWeight: 80,
          requestFields: [
            { id: "reference-track-id", name: "trackId", type: "string", location: "path" },
            { id: "reference-track-bitrate", name: "bitratePreference", type: "string", location: "query" },
          ],
          responseFields: [
            { id: "reference-track-title", name: "title", type: "string" },
            { id: "reference-track-artist", name: "artistId", type: "string" },
            { id: "reference-track-duration", name: "durationMs", type: "number" },
          ],
          steps: [
            ...(cacheId ? [{
              id: "reference-track-cache-read",
              kind: "cache-read" as const,
              targetNodeId: cacheId,
              target: "track:{trackId}:{bitratePreference}",
              cacheHitRate: 0.9,
            }] : []),
            ...(databaseId ? [{
              id: "reference-track-catalog-read",
              kind: "database-read" as const,
              targetNodeId: databaseId,
              target: "tracks.trackId,title,artistId,durationMs",
            }] : []),
            { id: "reference-track-response", kind: "respond" as const },
          ],
        },
        {
          id: "reference-music-play-event",
          method: "POST",
          path: "/plays",
          trafficWeight: 15,
          requestFields: [
            { id: "reference-play-user", name: "userId", type: "string", location: "body" },
            { id: "reference-play-track", name: "trackId", type: "string", location: "body" },
            { id: "reference-play-position", name: "positionMs", type: "number", location: "body" },
          ],
          responseFields: [
            { id: "reference-play-accepted", name: "accepted", type: "boolean" },
            { id: "reference-play-id", name: "playId", type: "string" },
          ],
          steps: [
            ...(queueId ? [{
              id: "reference-play-publish",
              kind: "publish-event" as const,
              targetNodeId: queueId,
              target: "play-events",
            }] : []),
            { id: "reference-play-response", kind: "respond" as const },
          ],
        },
        {
          id: "reference-music-recommendations",
          method: "GET",
          path: "/users/:userId/recommendations",
          trafficWeight: 5,
          requestFields: [
            { id: "reference-recommendations-user", name: "userId", type: "string", location: "path" },
          ],
          responseFields: [
            { id: "reference-recommendations-track-ids", name: "trackIds", type: "string" },
            { id: "reference-recommendations-generated-at", name: "generatedAt", type: "number" },
          ],
          steps: [
            ...(cacheId ? [{
              id: "reference-recommendations-cache-read",
              kind: "cache-read" as const,
              targetNodeId: cacheId,
              target: "recommendations:{userId}",
              cacheHitRate: 0.7,
            }] : []),
            ...(databaseId ? [{
              id: "reference-recommendations-database-read",
              kind: "database-read" as const,
              targetNodeId: databaseId,
              target: "user_recommendations.userId,trackIds,generatedAt",
            }] : []),
            { id: "reference-recommendations-response", kind: "respond" as const },
          ],
        },
      ];
    }

    for (const gateway of gateways) {
      if (!backend) continue;
      gateway.data.routes = [
        { id: "reference-music-route-track", method: "GET", path: "/tracks/:trackId", backendNodeId: backend.id, trafficWeight: 80 },
        { id: "reference-music-route-play", method: "POST", path: "/plays", backendNodeId: backend.id, trafficWeight: 15 },
        { id: "reference-music-route-recommendations", method: "GET", path: "/users/:userId/recommendations", backendNodeId: backend.id, trafficWeight: 5 },
      ];
    }

    for (const cache of caches) {
      cache.data.cacheConfig = {
        maxMemoryMB: 8192,
        defaultTtlSeconds: 300,
        evictionPolicy: "allkeys-lru",
      };
    }

    for (const queue of queues) {
      queue.data.queueDeliveryMode = "competing";
      queue.data.queueConfig = {
        topics: [{ id: "reference-play-events-topic", name: "play-events", retentionHours: 24 }],
        subscriptions: databaseId ? [{
          id: "reference-play-history-subscription",
          consumerNodeId: databaseId,
          topicName: "play-events",
        }] : [],
      };
    }

    for (const database of noSqlDatabases) {
      database.data.tables = [
        {
          id: "reference-track-catalog-table",
          name: "tracks",
          estimatedRows: 100_000_000,
          columns: [
            { id: "reference-track-id-column", name: "trackId", dataType: "TEXT", nullable: false, primaryKey: true },
            { id: "reference-track-title-column", name: "title", dataType: "TEXT", nullable: false, primaryKey: false },
            { id: "reference-track-artist-column", name: "artistId", dataType: "TEXT", nullable: false, primaryKey: false },
            { id: "reference-track-duration-column", name: "durationMs", dataType: "BIGINT", nullable: false, primaryKey: false },
            { id: "reference-track-genre-column", name: "genre", dataType: "TEXT", nullable: false, primaryKey: false },
          ],
          indexes: [{ id: "reference-tracks-artist-index", name: "tracks_artist_idx", columns: ["artistId"], unique: false }],
        },
        {
          id: "reference-play-history-table",
          name: "play_history",
          estimatedRows: 10_000_000_000,
          columns: [
            { id: "reference-play-id-column", name: "playId", dataType: "TEXT", nullable: false, primaryKey: true },
            { id: "reference-play-user-column", name: "userId", dataType: "TEXT", nullable: false, primaryKey: false },
            { id: "reference-play-track-column", name: "trackId", dataType: "TEXT", nullable: false, primaryKey: false },
            { id: "reference-play-position-column", name: "positionMs", dataType: "BIGINT", nullable: false, primaryKey: false },
            { id: "reference-play-timestamp-column", name: "playedAt", dataType: "BIGINT", nullable: false, primaryKey: false },
          ],
          indexes: [{ id: "reference-play-history-user-time-index", name: "play_history_user_time_idx", columns: ["userId", "playedAt"], unique: false }],
        },
        {
          id: "reference-user-recommendations-table",
          name: "user_recommendations",
          estimatedRows: 200_000_000,
          columns: [
            { id: "reference-recommendations-user-column", name: "userId", dataType: "TEXT", nullable: false, primaryKey: true },
            { id: "reference-recommendations-track-ids-column", name: "trackIds", dataType: "TEXT", nullable: false, primaryKey: false },
            { id: "reference-recommendations-generated-at-column", name: "generatedAt", dataType: "BIGINT", nullable: false, primaryKey: false },
          ],
          indexes: [],
        },
      ];
    }
  }

  if (problem.id === "instagram") {
    const appServers = refNodes.filter((node) => node.data.componentId === "app-server");
    const gateways = refNodes.filter((node) => node.data.componentId === "api-gateway");
    const caches = refNodes.filter((node) => node.data.componentId === "cache");
    const queues = refNodes.filter((node) => node.data.componentId === "message-queue");
    const processors = refNodes.filter((node) => node.data.componentId === "stream-processor");
    const databases = refNodes.filter((node) => node.data.componentId === "nosql-db");
    const backend = appServers[0];
    const cacheId = caches[0]?.id;
    const queueId = queues[0]?.id;
    const databaseId = databases[0]?.id;

    for (const appServer of appServers) {
      appServer.data.replicas = 3;
      appServer.data.endpoints = [
        {
          id: "reference-instagram-create-post",
          method: "POST",
          path: "/posts",
          trafficWeight: 15,
          requestFields: [
            { id: "reference-instagram-post-user", name: "userId", type: "string", location: "body" },
            { id: "reference-instagram-post-caption", name: "caption", type: "string", location: "body" },
            { id: "reference-instagram-post-media-key", name: "mediaKey", type: "string", location: "body" },
          ],
          responseFields: [
            { id: "reference-instagram-post-id", name: "postId", type: "string" },
            { id: "reference-instagram-post-status", name: "status", type: "string" },
          ],
          steps: [
            ...(databaseId ? [{
              id: "reference-instagram-post-write",
              kind: "database-write" as const,
              targetNodeId: databaseId,
              target: "posts.postId,userId,caption,createdAt,mediaKey,status",
            }] : []),
            ...(queueId ? [{
              id: "reference-instagram-photo-publish",
              kind: "publish-event" as const,
              targetNodeId: queueId,
              target: "photo-processing",
            }] : []),
            { id: "reference-instagram-post-response", kind: "respond" as const },
          ],
        },
        {
          id: "reference-instagram-feed",
          method: "GET",
          path: "/feed",
          trafficWeight: 65,
          requestFields: [
            { id: "reference-instagram-feed-user", name: "userId", type: "string", location: "query" },
            { id: "reference-instagram-feed-cursor", name: "cursor", type: "string", location: "query" },
          ],
          responseFields: [
            { id: "reference-instagram-feed-posts", name: "posts", type: "string" },
            { id: "reference-instagram-feed-next-cursor", name: "nextCursor", type: "string" },
          ],
          steps: [
            ...(cacheId ? [{
              id: "reference-instagram-feed-cache-read",
              kind: "cache-read" as const,
              targetNodeId: cacheId,
              target: "feed:{userId}:{cursor}",
              cacheHitRate: 0.75,
            }] : []),
            ...(databaseId ? [{
              id: "reference-instagram-feed-read",
              kind: "database-read" as const,
              targetNodeId: databaseId,
              target: "posts.userId,postId,caption,createdAt,mediaKey",
            }] : []),
            { id: "reference-instagram-feed-response", kind: "respond" as const },
          ],
        },
        {
          id: "reference-instagram-like-post",
          method: "POST",
          path: "/posts/:postId/likes",
          trafficWeight: 15,
          requestFields: [
            { id: "reference-instagram-like-post-id", name: "postId", type: "string", location: "path" },
            { id: "reference-instagram-like-user", name: "userId", type: "string", location: "body" },
          ],
          responseFields: [{ id: "reference-instagram-like-result", name: "liked", type: "boolean" }],
          steps: [
            ...(databaseId ? [{
              id: "reference-instagram-like-write",
              kind: "database-write" as const,
              targetNodeId: databaseId,
              target: "likes.likeId,postId,userId,createdAt",
            }] : []),
            { id: "reference-instagram-like-response", kind: "respond" as const },
          ],
        },
        {
          id: "reference-instagram-profile",
          method: "GET",
          path: "/profiles/:userId",
          trafficWeight: 5,
          requestFields: [
            { id: "reference-instagram-profile-user", name: "userId", type: "string", location: "path" },
          ],
          responseFields: [
            { id: "reference-instagram-profile-username", name: "username", type: "string" },
            { id: "reference-instagram-profile-bio", name: "bio", type: "string" },
          ],
          steps: [
            ...(cacheId ? [{
              id: "reference-instagram-profile-cache-read",
              kind: "cache-read" as const,
              targetNodeId: cacheId,
              target: "profile:{userId}",
              cacheHitRate: 0.85,
            }] : []),
            ...(databaseId ? [{
              id: "reference-instagram-profile-read",
              kind: "database-read" as const,
              targetNodeId: databaseId,
              target: "user_profiles.userId,username,bio,avatarKey",
            }] : []),
            { id: "reference-instagram-profile-response", kind: "respond" as const },
          ],
        },
      ];
    }

    for (const gateway of gateways) {
      if (!backend) continue;
      gateway.data.routes = [
        { id: "reference-instagram-route-post", method: "POST", path: "/posts", backendNodeId: backend.id, trafficWeight: 15 },
        { id: "reference-instagram-route-feed", method: "GET", path: "/feed", backendNodeId: backend.id, trafficWeight: 65 },
        { id: "reference-instagram-route-like", method: "POST", path: "/posts/:postId/likes", backendNodeId: backend.id, trafficWeight: 15 },
        { id: "reference-instagram-route-profile", method: "GET", path: "/profiles/:userId", backendNodeId: backend.id, trafficWeight: 5 },
      ];
    }

    for (const cache of caches) {
      cache.data.cacheConfig = {
        maxMemoryMB: 2048,
        defaultTtlSeconds: 300,
        evictionPolicy: "allkeys-lru",
      };
    }

    for (const queue of queues) {
      queue.data.queueDeliveryMode = "competing";
      queue.data.queueConfig = {
        topics: [{ id: "reference-photo-processing-topic", name: "photo-processing", retentionHours: 24 }],
        subscriptions: processors.map((processor, index) => ({
          id: `reference-photo-processor-${index + 1}`,
          consumerNodeId: processor.id,
          topicName: "photo-processing",
        })),
      };
    }

    for (const database of databases) {
      database.data.tables = [
        {
          id: "reference-instagram-posts-table",
          name: "posts",
          estimatedRows: 100_000_000_000,
          columns: [
            { id: "reference-instagram-post-pk", name: "postId", dataType: "TEXT", nullable: false, primaryKey: true },
            { id: "reference-instagram-post-user-column", name: "userId", dataType: "TEXT", nullable: false, primaryKey: false },
            { id: "reference-instagram-post-caption-column", name: "caption", dataType: "TEXT", nullable: false, primaryKey: false },
            { id: "reference-instagram-post-created-column", name: "createdAt", dataType: "BIGINT", nullable: false, primaryKey: false },
            { id: "reference-instagram-post-media-column", name: "mediaKey", dataType: "TEXT", nullable: false, primaryKey: false },
            { id: "reference-instagram-post-status-column", name: "status", dataType: "TEXT", nullable: false, primaryKey: false },
          ],
          indexes: [{ id: "reference-instagram-post-user-feed-index", name: "posts_user_created_idx", columns: ["userId", "createdAt"], unique: false }],
        },
        {
          id: "reference-instagram-likes-table",
          name: "likes",
          estimatedRows: 1_000_000_000_000,
          columns: [
            { id: "reference-instagram-like-pk", name: "likeId", dataType: "TEXT", nullable: false, primaryKey: true },
            { id: "reference-instagram-like-post-column", name: "postId", dataType: "TEXT", nullable: false, primaryKey: false },
            { id: "reference-instagram-like-user-column", name: "userId", dataType: "TEXT", nullable: false, primaryKey: false },
            { id: "reference-instagram-like-created-column", name: "createdAt", dataType: "BIGINT", nullable: false, primaryKey: false },
          ],
          indexes: [{ id: "reference-instagram-like-post-index", name: "likes_post_created_idx", columns: ["postId", "createdAt"], unique: false }],
        },
        {
          id: "reference-instagram-profiles-table",
          name: "user_profiles",
          estimatedRows: 500_000_000,
          columns: [
            { id: "reference-instagram-profile-pk", name: "userId", dataType: "TEXT", nullable: false, primaryKey: true },
            { id: "reference-instagram-profile-username-column", name: "username", dataType: "TEXT", nullable: false, primaryKey: false },
            { id: "reference-instagram-profile-bio-column", name: "bio", dataType: "TEXT", nullable: false, primaryKey: false },
            { id: "reference-instagram-profile-avatar-column", name: "avatarKey", dataType: "TEXT", nullable: false, primaryKey: false },
          ],
          indexes: [{ id: "reference-instagram-profile-username-index", name: "user_profiles_username_idx", columns: ["username"], unique: true }],
        },
      ];
    }
  }

  if (problem.id === "video-streaming") {
    const appServers = refNodes.filter((node) => node.data.componentId === "app-server");
    const gateways = refNodes.filter((node) => node.data.componentId === "api-gateway");
    const caches = refNodes.filter((node) => node.data.componentId === "cache");
    const queues = refNodes.filter((node) => node.data.componentId === "message-queue");
    const processors = refNodes.filter((node) => node.data.componentId === "stream-processor");
    const databases = refNodes.filter((node) => node.data.componentId === "sql-db");
    const backend = appServers[0];
    const cacheId = caches[0]?.id;
    const queueId = queues[0]?.id;
    const databaseId = databases[0]?.id;

    for (const appServer of appServers) {
      appServer.data.replicas = 3;
      appServer.data.endpoints = [
        {
          id: "reference-video-details",
          method: "GET",
          path: "/videos/:videoId",
          trafficWeight: 70,
          requestFields: [
            { id: "reference-video-details-id", name: "videoId", type: "string", location: "path" },
          ],
          responseFields: [
            { id: "reference-video-details-title", name: "title", type: "string" },
            { id: "reference-video-details-duration", name: "durationSeconds", type: "number" },
            { id: "reference-video-details-status", name: "status", type: "string" },
            { id: "reference-video-details-stream-key", name: "storageKey", type: "string" },
          ],
          steps: [
            ...(cacheId ? [{
              id: "reference-video-details-cache-read",
              kind: "cache-read" as const,
              targetNodeId: cacheId,
              target: "video:{videoId}",
              cacheHitRate: 0.8,
            }] : []),
            ...(databaseId ? [{
              id: "reference-video-details-read",
              kind: "database-read" as const,
              targetNodeId: databaseId,
              target: "videos.videoId,title,durationSeconds,status,storageKey",
            }] : []),
            { id: "reference-video-details-response", kind: "respond" as const },
          ],
        },
        {
          id: "reference-video-upload-intent",
          method: "POST",
          path: "/videos",
          trafficWeight: 15,
          requestFields: [
            { id: "reference-video-owner", name: "creatorId", type: "string", location: "body" },
            { id: "reference-video-title", name: "title", type: "string", location: "body" },
            { id: "reference-video-description", name: "description", type: "string", location: "body" },
            { id: "reference-video-duration", name: "durationSeconds", type: "number", location: "body" },
          ],
          responseFields: [
            { id: "reference-video-upload-id", name: "videoId", type: "string" },
            { id: "reference-video-upload-url", name: "uploadUrl", type: "string" },
          ],
          steps: [
            ...(databaseId ? [{
              id: "reference-video-metadata-create",
              kind: "database-write" as const,
              targetNodeId: databaseId,
              target: "videos.videoId,creatorId,title,description,status,createdAt,durationSeconds,storageKey",
            }] : []),
            { id: "reference-video-upload-response", kind: "respond" as const },
          ],
        },
        {
          id: "reference-video-upload-complete",
          method: "POST",
          path: "/videos/:videoId/complete",
          trafficWeight: 5,
          requestFields: [
            { id: "reference-video-complete-id", name: "videoId", type: "string", location: "path" },
            { id: "reference-video-complete-key", name: "storageKey", type: "string", location: "body" },
          ],
          responseFields: [
            { id: "reference-video-complete-accepted", name: "accepted", type: "boolean" },
            { id: "reference-video-complete-status", name: "status", type: "string" },
          ],
          steps: [
            ...(databaseId ? [{
              id: "reference-video-mark-transcoding",
              kind: "database-write" as const,
              targetNodeId: databaseId,
              target: "videos.videoId,status,storageKey,completedAt",
            }] : []),
            ...(queueId ? [{
              id: "reference-video-transcoding-publish",
              kind: "publish-event" as const,
              targetNodeId: queueId,
              target: "transcoding-jobs",
            }] : []),
            { id: "reference-video-complete-response", kind: "respond" as const },
          ],
        },
        {
          id: "reference-video-creator-list",
          method: "GET",
          path: "/creators/:creatorId/videos",
          trafficWeight: 10,
          requestFields: [
            { id: "reference-video-list-creator", name: "creatorId", type: "string", location: "path" },
          ],
          responseFields: [{ id: "reference-video-list-items", name: "videos", type: "string" }],
          steps: [
            ...(cacheId ? [{
              id: "reference-video-list-cache-read",
              kind: "cache-read" as const,
              targetNodeId: cacheId,
              target: "creator-videos:{creatorId}",
              cacheHitRate: 0.75,
            }] : []),
            ...(databaseId ? [{
              id: "reference-video-list-read",
              kind: "database-read" as const,
              targetNodeId: databaseId,
              target: "videos.creatorId,videoId,title,createdAt,status",
            }] : []),
            { id: "reference-video-list-response", kind: "respond" as const },
          ],
        },
      ];
    }

    for (const gateway of gateways) {
      if (!backend) continue;
      gateway.data.routes = [
        { id: "reference-video-route-details", method: "GET", path: "/videos/:videoId", backendNodeId: backend.id, trafficWeight: 70 },
        { id: "reference-video-route-upload", method: "POST", path: "/videos", backendNodeId: backend.id, trafficWeight: 15 },
        { id: "reference-video-route-complete", method: "POST", path: "/videos/:videoId/complete", backendNodeId: backend.id, trafficWeight: 5 },
        { id: "reference-video-route-creator-list", method: "GET", path: "/creators/:creatorId/videos", backendNodeId: backend.id, trafficWeight: 10 },
      ];
    }

    for (const cache of caches) {
      cache.data.cacheConfig = {
        maxMemoryMB: 4096,
        defaultTtlSeconds: 600,
        evictionPolicy: "allkeys-lru",
      };
    }

    for (const queue of queues) {
      queue.data.queueDeliveryMode = "competing";
      queue.data.queueConfig = {
        topics: [{ id: "reference-transcoding-jobs-topic", name: "transcoding-jobs", retentionHours: 24 }],
        subscriptions: processors.map((processor, index) => ({
          id: `reference-transcoding-worker-${index + 1}`,
          consumerNodeId: processor.id,
          topicName: "transcoding-jobs",
        })),
      };
    }

    for (const processor of processors) {
      processor.data.replicas = 3;
    }

    for (const database of databases) {
      database.data.replicas = 3;
      database.data.tables = [{
        id: "reference-videos-table",
        name: "videos",
        estimatedRows: 10_000_000_000,
        columns: [
          { id: "reference-video-id-column", name: "videoId", dataType: "TEXT", nullable: false, primaryKey: true },
          { id: "reference-video-creator-column", name: "creatorId", dataType: "TEXT", nullable: false, primaryKey: false },
          { id: "reference-video-title-column", name: "title", dataType: "TEXT", nullable: false, primaryKey: false },
          { id: "reference-video-description-column", name: "description", dataType: "TEXT", nullable: false, primaryKey: false },
          { id: "reference-video-status-column", name: "status", dataType: "TEXT", nullable: false, primaryKey: false },
          { id: "reference-video-created-column", name: "createdAt", dataType: "BIGINT", nullable: false, primaryKey: false },
          { id: "reference-video-completed-column", name: "completedAt", dataType: "BIGINT", nullable: true, primaryKey: false },
          { id: "reference-video-duration-column", name: "durationSeconds", dataType: "BIGINT", nullable: false, primaryKey: false },
          { id: "reference-video-storage-key-column", name: "storageKey", dataType: "TEXT", nullable: true, primaryKey: false },
        ],
        indexes: [{
          id: "reference-videos-creator-created-index",
          name: "videos_creator_created_idx",
          columns: ["creatorId", "createdAt"],
          unique: false,
        }],
      }];
    }
  }

  if (problem.id === "parking-lot") {
    const appServers = refNodes.filter((node) => node.data.componentId === "app-server");
    const gateways = refNodes.filter((node) => node.data.componentId === "api-gateway");
    const cacheId = instancesByComponent.get("cache")?.[0];
    const queueId = instancesByComponent.get("message-queue")?.[0];
    const databaseId = instancesByComponent.get("sql-db")?.[0];

    for (const appServer of appServers) {
      // Size the sample for the default 10k QPS simulation preset.
      appServer.data.replicas = 3;
      appServer.data.endpoints = [
        {
          id: "reference-parking-availability",
          method: "GET",
          path: "/lots/:lotId/availability",
          trafficWeight: 95,
          requestFields: [
            { id: "reference-lot-id", name: "lotId", type: "string", location: "path" },
            { id: "reference-spot-type", name: "spotType", type: "string", location: "query" },
          ],
          responseFields: [
            { id: "reference-available-spots", name: "availableSpots", type: "number" },
            { id: "reference-availability-updated-at", name: "updatedAt", type: "number" },
          ],
          steps: [
            ...(cacheId ? [{
              id: "reference-parking-cache-read",
              kind: "cache-read" as const,
              targetNodeId: cacheId,
              target: "lot:{lotId}:availability",
              cacheHitRate: 0.8,
            }] : []),
            ...(databaseId ? [{
              id: "reference-parking-availability-read",
              kind: "database-read" as const,
              targetNodeId: databaseId,
              target: "spots.lotId",
            }] : []),
            { id: "reference-parking-availability-response", kind: "respond" as const },
          ],
        },
        {
          id: "reference-parking-reservation",
          method: "POST",
          path: "/lots/:lotId/reservations",
          trafficWeight: 4,
          requestFields: [
            { id: "reference-reservation-lot-id", name: "lotId", type: "string", location: "path" },
            { id: "reference-reservation-spot-id", name: "spotId", type: "string", location: "body" },
            { id: "reference-reservation-start", name: "startTime", type: "number", location: "body" },
            { id: "reference-reservation-end", name: "endTime", type: "number", location: "body" },
          ],
          responseFields: [
            { id: "reference-reservation-id", name: "reservationId", type: "string" },
            { id: "reference-reservation-status", name: "status", type: "string" },
          ],
          steps: [
            ...(databaseId ? [{
              id: "reference-reservation-spot-read",
              kind: "database-read" as const,
              targetNodeId: databaseId,
              target: "spots.spotId",
            }, {
              id: "reference-reservation-write",
              kind: "database-write" as const,
              targetNodeId: databaseId,
              target: "reservations.spotId,lotId,startTime,endTime,status",
            }] : []),
            ...(cacheId ? [{
              id: "reference-reservation-cache-invalidate",
              kind: "cache-invalidate" as const,
              targetNodeId: cacheId,
              target: "lot:{lotId}:availability",
            }] : []),
            ...(queueId ? [{
              id: "reference-reservation-publish",
              kind: "publish-event" as const,
              targetNodeId: queueId,
              target: "reservation-events",
            }] : []),
            { id: "reference-reservation-response", kind: "respond" as const },
          ],
        },
        {
          id: "reference-parking-sensor-event",
          method: "POST",
          path: "/sensor-events",
          trafficWeight: 1,
          requestFields: [
            { id: "reference-sensor-lot-id", name: "lotId", type: "string", location: "body" },
            { id: "reference-sensor-spot-id", name: "spotId", type: "string", location: "body" },
            { id: "reference-sensor-occupied", name: "occupied", type: "boolean", location: "body" },
            { id: "reference-sensor-timestamp", name: "timestamp", type: "number", location: "body" },
          ],
          responseFields: [{ id: "reference-sensor-accepted", name: "accepted", type: "boolean" }],
          steps: [
            ...(queueId ? [{
              id: "reference-sensor-publish",
              kind: "publish-event" as const,
              targetNodeId: queueId,
              target: "parking-events",
            }] : []),
            { id: "reference-sensor-response", kind: "respond" as const },
          ],
        },
      ];
    }

    for (const gateway of gateways) {
      const backend = appServers[0];
      if (!backend) continue;
      gateway.data.routes = [
        { id: "reference-parking-route-availability", method: "GET", path: "/lots/:lotId/availability", backendNodeId: backend.id, trafficWeight: 95 },
        { id: "reference-parking-route-reservation", method: "POST", path: "/lots/:lotId/reservations", backendNodeId: backend.id, trafficWeight: 4 },
        { id: "reference-parking-route-sensor-event", method: "POST", path: "/sensor-events", backendNodeId: backend.id, trafficWeight: 1 },
      ];
    }

    for (const cache of refNodes.filter((node) => node.data.componentId === "cache")) {
      cache.data.cacheConfig = {
        maxMemoryMB: 1024,
        defaultTtlSeconds: 300,
        evictionPolicy: "allkeys-lru",
      };
    }

    for (const queue of refNodes.filter((node) => node.data.componentId === "message-queue")) {
      queue.data.queueDeliveryMode = "competing";
      queue.data.queueConfig = {
        topics: [
          { id: "reference-reservation-events", name: "reservation-events", retentionHours: 24 },
          { id: "reference-parking-events", name: "parking-events", retentionHours: 24 },
        ],
        subscriptions: databaseId ? [
          { id: "reference-reservation-db-subscription", consumerNodeId: databaseId, topicName: "reservation-events" },
          { id: "reference-parking-db-subscription", consumerNodeId: databaseId, topicName: "parking-events" },
        ] : [],
      };
    }

    for (const database of refNodes.filter((node) => node.data.componentId === "sql-db")) {
      database.data.replicas = 2;
      database.data.tables = [
        {
          id: "reference-parking-spots-table",
          name: "spots",
          estimatedRows: 10_000_000,
          columns: [
            { id: "reference-spot-id-column", name: "spotId", dataType: "TEXT", nullable: false, primaryKey: true },
            { id: "reference-spot-lot-id-column", name: "lotId", dataType: "TEXT", nullable: false, primaryKey: false },
            { id: "reference-spot-type-column", name: "spotType", dataType: "TEXT", nullable: false, primaryKey: false },
            { id: "reference-spot-status-column", name: "status", dataType: "TEXT", nullable: false, primaryKey: false },
            { id: "reference-spot-updated-at-column", name: "lastEventTime", dataType: "BIGINT", nullable: false, primaryKey: false },
          ],
          indexes: [{ id: "reference-spots-lot-status-index", name: "spots_lot_status_idx", columns: ["lotId", "status"], unique: false }],
        },
        {
          id: "reference-parking-reservations-table",
          name: "reservations",
          estimatedRows: 5_000_000,
          columns: [
            { id: "reference-reservation-id-column", name: "reservationId", dataType: "TEXT", nullable: false, primaryKey: true },
            { id: "reference-reservation-spot-column", name: "spotId", dataType: "TEXT", nullable: false, primaryKey: false },
            { id: "reference-reservation-lot-column", name: "lotId", dataType: "TEXT", nullable: false, primaryKey: false },
            { id: "reference-reservation-start-column", name: "startTime", dataType: "BIGINT", nullable: false, primaryKey: false },
            { id: "reference-reservation-end-column", name: "endTime", dataType: "BIGINT", nullable: false, primaryKey: false },
            { id: "reference-reservation-status-column", name: "status", dataType: "TEXT", nullable: false, primaryKey: false },
          ],
          indexes: [{ id: "reference-reservations-spot-start-index", name: "reservations_spot_start_idx", columns: ["spotId", "startTime"], unique: false }],
        },
      ];
    }
  }

  for (const limiter of refNodes.filter((node) => node.data.componentId === "rate-limiter")) {
    limiter.data.rateLimiterConfig = {
      algorithm: "token-bucket",
      keyBy: "client-id",
      requestsPerWindow: 50,
      windowSeconds: 1,
      estimatedDistinctKeys: 1000,
      burstCapacity: 100,
    };
  }

  // Round-robin counters, keyed by `${componentId}#${role}`
  const rrCounters = new Map<string, number>();
  const nextInstance = (componentId: string, role: "source" | "target"): string | undefined => {
    const instances = instancesByComponent.get(componentId);
    if (!instances || instances.length === 0) return undefined;
    const key = `${componentId}#${role}`;
    const count = rrCounters.get(key) ?? 0;
    rrCounters.set(key, count + 1);
    return instances[count % instances.length];
  };

  const refEdges: Edge[] = [];
  for (const ref of problem.referenceSolution.edges) {
    const sourceId = nextInstance(ref.source, "source");
    const targetId = nextInstance(ref.target, "target");
    if (sourceId && targetId) {
      const isVideoProcessingStorageWrite =
        problem.id === "video-streaming" &&
        ref.source === "stream-processor" &&
        ref.target === "object-storage";
      const isAsyncPubSubEdge =
        (problem.id === "parking-lot" && ref.source === "message-queue" && ref.target === "sql-db") ||
        (problem.id === "notification-system" && ref.source === "message-queue" && ref.target === "notification-service") ||
        (problem.id === "music-streaming" && ref.source === "message-queue" && ref.target === "nosql-db") ||
        (problem.id === "instagram" && ref.source === "message-queue" && ref.target === "stream-processor") ||
        (problem.id === "video-streaming" && ref.source === "message-queue" && ref.target === "stream-processor");
      refEdges.push({
        id: `e-${sourceId}-${targetId}`,
        source: sourceId,
        target: targetId,
        type: "animated",
        ...(isVideoProcessingStorageWrite
          ? { data: { protocol: "http", async: true } }
          : isAsyncPubSubEdge
            ? { data: { protocol: "pubsub", async: true } }
            : {}),
      });
    }
  }

  return { nodes: refNodes, edges: refEdges };
}

/**
 * Open a problem's reference solution in a read-only canvas tab.
 * The user's current design stays untouched in its own tab.
 */
export function loadReferenceIntoTab(problem: Problem): void {
  const { nodes, edges } = buildReferenceGraph(problem);
  const compilation = compileDesign(nodes, edges);
  const designOnly = !compilation.ok;

  useCanvasStore.getState().addTab({
    id: `ref-${problem.id}`,
    label: designOnly
      ? `${problem.title} (Architecture Only)`
      : `${problem.title} (Reference)`,
    nodes,
    edges,
    readOnly: true,
    designOnly,
  });

  useAppStore
    .getState()
    .showToast(
      designOnly
        ? "Architecture-only reference opened — compile issues prevent simulation"
        : "Reference opened in new tab — your design is safe",
      designOnly ? "info" : "success"
    );
}
