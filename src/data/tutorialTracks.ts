import type { SystemTutorial, TutorialLevel, TutorialStep } from "@/types/tutorial";
import { PROBLEMS } from "@/data/problems";
import { MAX_SIMULATION_QPS, MIN_SIMULATION_QPS } from "@/engine/constants";

type TrackSpec = {
  problemId: string;
  title: string;
  focus: string;
  table: string;
  columns: string[];
  index: string;
  readPath: string;
  writePath: string;
  database?: string;
  extraCore?: string[];
  middle: "cache" | "queue";
  middleFocus: string;
  middleWhy: string;
  middleTradeoff: string;
  middleExtraSteps?: TutorialStep[];
  highComponent: string;
  highFocus: string;
  highWhy: string;
  highTradeoff: string;
  highEdge?: [string, string];
  highExtra?: string[];
  highExtraSteps?: TutorialStep[];
};

const specs: TrackSpec[] = [
  {
    problemId: "twitter-feed", title: "Twitter / News Feed", focus: "posting and reading a personalized timeline", table: "posts", columns: ["postId", "authorId", "body", "createdAt"], index: "authorId", readPath: "/timeline", writePath: "/posts", middle: "queue", middleFocus: "fan out new posts asynchronously", middleWhy: "A queue separates post acceptance from timeline fan-out, so follower delivery can scale independently and celebrity posts do not block the write API.", middleTradeoff: "Fan-out-on-write speeds ordinary reads but amplifies writes; high-follower accounts need a hybrid or read-time merge, which remains a design discussion here.", highComponent: "sharded-counter", highFocus: "protect engagement counts from hot-key writes", highWhy: "A sharded counter spreads likes and repost counts across keys, then aggregates them for reads instead of sending every update to one hot record.", highTradeoff: "Aggregated counts may be briefly stale; timeline ranking and recommendation quality are not modeled.", highExtraSteps: [{
      id: "twitter-feed-high-hash-partition-estimate",
      title: "Estimate hot-author partition skew",
      prompt: "Configure hash partitioning for posts using authorId, at least 16 shards, and estimate the hottest author's key at 20% of table traffic. Set an illustrative per-shard modeled work capacity of 1000 work/s, run the simulation, and compare estimated hot-shard work and utilization with the uniform-shard baseline.",
      why: "If 20% of traffic belongs to one author and the remaining traffic hashes uniformly across 16 shards, the shard containing that author receives an expected 25% of traffic, compared with 6.25% under perfectly uniform keys. This makes the celebrity skew visible as a directional estimate.",
      tradeoff: "The model reports a directional work estimate using the configured per-shard capacity; it does not change database throughput or simulate actual hash placement, reads, writes, query fan-out, or range boundaries. The 1000 work/s capacity is illustrative, not a recommendation. Consider hybrid fan-out or a carefully designed composite/salted strategy for hot authors, with the added read/aggregation complexity.",
      objective: { kind: "database-partitioning", databaseComponentId: "sql-db", tableName: "posts", keyColumn: "authorId", minimumShards: 16, minimumHotKeyTrafficShare: 0.2, minimumEstimatedWorkCapacityPerShard: 1000 },
    }, {
      id: "twitter-feed-high-shard-key-hotspot-review",
      title: "Compare shard keys and hot-key risk",
      prompt: "Compare authorId and postId as candidate partition keys for the posts workload. Explain why authorId can make an author's posts easier to group for reads but concentrate a celebrity's writes, while postId can spread writes but make per-author timeline reads require another index or fan-out. Include one mitigation for the hot author.",
      why: "A partition key determines which records share a partition and strongly affects both routing efficiency and load distribution. A key that makes one access pattern local can create skew for popular values.",
      tradeoff: "This is a self-assessed design reflection. The simulator does not model database partition keys, range boundaries, query fan-out, or hot-key skew; choose based on measured workload and access patterns.",
      objective: { kind: "reflection", prompt: "Compare authorId and postId for the feed workload.", limitation: "The platform does not simulate database shard placement or key skew." },
    }, {
      id: "twitter-feed-high-read-replica-capacity",
      title: "Estimate read-copy capacity",
      prompt: "Configure two additional read-serving copies on the SQL Database and assume they could serve 80% of modeled read work. Enter an estimated lag of 800 ms and a scenario-specific maximum tolerated read staleness of 500 ms. Run the high-load scenario, compare primary/copy work and capacity in Metrics, and inspect the advisory stale-read risk warning. Explain why these inputs are assumptions to replace with measured workload and database behavior before production.",
      why: "A hypothetical read split makes the capacity implication of offloading read work visible, while comparing a lag assumption with a freshness budget highlights when replica-served reads may be unsuitable for the scenario.",
      tradeoff: "These are user-supplied estimates, not measured lag or a simulated consistency policy. The simulator does not route reads, account for replication overhead, model freshness or failover, or change actual DB utilization or throughput; the warning only compares the two inputs.",
      objective: { kind: "database-read-replicas", databaseComponentId: "sql-db", minimumReplicas: 2, requiredReadTrafficToReplicasShare: 0.8, requiredEstimatedReplicationLagMs: 800, requiredMaximumToleratedReadStalenessMs: 500 },
    }],
  },
  {
    problemId: "chat-system", title: "Chat System", focus: "reliable one-to-one and group message delivery", table: "messages", columns: ["conversationId", "messageId", "senderId", "createdAt"], index: "conversationId", readPath: "/conversations/:id/messages", writePath: "/conversations/:id/messages", middle: "queue", middleFocus: "store and forward messages for offline recipients", middleWhy: "The broker decouples accepting a message from delivery to connected devices and gives offline delivery a durable handoff point.", middleTradeoff: "At-least-once delivery requires message IDs and consumer deduplication; strict per-conversation ordering is a partitioning policy not verified by this model.", middleExtraSteps: [{
      id: "chat-system-medium-ordering-scope",
      title: "Choose an ordering scope for conversations",
      prompt: "Consider using conversationId as a message partition key so one conversation's records are assigned to the same ordered partition. Explain why this offers at most per-partition log order, not global order or guaranteed user-observed effect order. Address concurrent producers and retries (which can change append order), serial processing within a partition versus parallel work completing out of order, and how a very active conversation can become a hot partition. Describe the throughput and ordering trade-off and a way to detect or mitigate hot conversations.",
      why: "Ordering is a scoped property. Key affinity can keep one conversation's stream together, but the system must also define producer sequencing, retry behavior, and consumer concurrency; preserving a narrow order often limits parallelism for that key.",
      tradeoff: "This is a self-assessed design reflection. The simulator does not model keyed partition assignment, broker append ordering, producer retries, consumer completion order, or hot-key load; it cannot verify message ordering.",
      objective: { kind: "reflection", prompt: "Explain per-conversation ordering scope and its parallelism/hot-key trade-offs.", limitation: "The platform does not simulate keyed queue ordering or consumer execution." },
    }], highComponent: "websocket-server", highFocus: "maintain persistent connections for online delivery", highWhy: "A dedicated connection tier holds long-lived client sessions so message delivery does not depend on repeated polling requests.", highTradeoff: "Connection routing, presence TTLs, read receipts, and end-to-end encryption need real protocol and state-machine design beyond this simulator.",
  },
  {
    problemId: "ride-sharing", title: "Ride Sharing", focus: "requesting a trip and matching a nearby driver", table: "trips", columns: ["tripId", "riderId", "driverId", "status", "createdAt"], index: "status", readPath: "/drivers/nearby", writePath: "/trips", middle: "queue", middleFocus: "ingest driver location updates asynchronously", middleWhy: "Location updates arrive continuously and should not contend with trip creation transactions; a stream-processing consumer can update nearby-driver state separately.", middleTradeoff: "The actual geospatial index, matching fairness, and ETA model are not simulated; avoid treating a queue edge as proof of correct matching.", highComponent: "geospatial-index", highFocus: "make proximity lookup an explicit storage tier", highWhy: "A geospatial index supports radius and nearest-neighbor queries more directly than scanning every driver's row.", highTradeoff: "Geohash cells, regional partitioning, stale GPS updates, and ETA prediction require workload-specific tuning not represented by the aggregate graph.",
  },
  {
    problemId: "notification-system", title: "Notification System", focus: "accepting and delivering notifications across channels", table: "notifications", columns: ["notificationId", "userId", "channel", "status", "createdAt"], index: "userId", readPath: "/notifications/:id", writePath: "/notifications", middle: "queue", middleFocus: "move provider delivery behind a queue", middleWhy: "External email, SMS, and push providers have variable latency and quotas. Queuing lets the API acknowledge accepted work while workers retry delivery independently.", middleTradeoff: "Retries can duplicate sends unless delivery is idempotent; provider-specific rate limits and dead-letter handling are operational concerns.", highComponent: "notification-service", highFocus: "separate channel orchestration from product APIs", highWhy: "A notification service centralizes templates, channel selection, and provider integration instead of duplicating delivery logic in every product service.", highTradeoff: "Provider availability, bounce processing, localization, and delivery receipts are not guaranteed by this architecture sketch.",
  },
  {
    problemId: "typeahead-autocomplete", title: "Typeahead / Autocomplete", focus: "serving low-latency prefix suggestions", table: "suggestions", columns: ["prefix", "suggestion", "score", "updatedAt"], index: "prefix", readPath: "/suggestions", writePath: "/suggestions/rebuild", middle: "cache", middleFocus: "cache common prefixes", middleWhy: "Short, popular prefixes repeat across users. A cache can serve those hot lookups without querying the suggestion index on every keystroke.", middleTradeoff: "Cached suggestions can lag after a rebuild; prefix popularity and typing patterns are not modeled by the simulator.", highComponent: "search", highFocus: "use an index optimized for text lookup", highWhy: "A search index can support prefix retrieval and ranking over a larger suggestion corpus more efficiently than scanning application records.", highTradeoff: "Trie layout, fuzzy matching, ranking freshness, and offensive-content filtering remain algorithm and product-policy decisions.",
  },
  {
    problemId: "web-crawler", title: "Web Crawler", focus: "scheduling URLs and storing fetched pages", table: "crawl_pages", columns: ["url", "contentHash", "status", "fetchedAt"], index: "url", readPath: "/pages/:url", writePath: "/crawl-jobs", middle: "queue", middleFocus: "make the crawl frontier a durable queue", middleWhy: "A queue separates URL discovery from fetch workers and buffers a growing frontier without forcing one scheduler to perform every network request.", middleTradeoff: "Per-domain politeness, robots.txt enforcement, DNS caching, and retry scheduling must be implemented by the crawler and are not implied by queue configuration.", highComponent: "rate-limiter", highFocus: "enforce a per-domain crawl budget", highWhy: "A rate limiter helps prevent aggressive fetchers from overwhelming one origin and makes politeness policy an explicit part of the design.", highTradeoff: "The generic limiter does not model domain-specific keys, robots rules, or precise delay windows unless separately configured in a real implementation.",
  },
  {
    problemId: "distributed-cache", title: "Distributed Cache", focus: "serving key-value reads from a cache cluster", table: "cache_entries", columns: ["key", "value", "expiresAt"], index: "key", readPath: "/cache/:key", writePath: "/cache/:key", database: "nosql-db", middle: "queue", middleFocus: "broadcast cache-change events to subscribers", middleWhy: "A change stream can notify dependent services or cache replicas when values are updated, rather than coupling every consumer directly to the writer.", middleTradeoff: "The lesson models event topology, not invalidation ordering or cache coherence; consistent hashing and eviction algorithms remain conceptual.", highComponent: "coordination-service", highFocus: "introduce coordination for membership and failover", highWhy: "A coordination service can track cluster membership and leadership decisions as the cache grows beyond one node.", highTradeoff: "Consensus, failover timing, and cross-region consistency are not simulated; coordination adds a dependency that itself needs availability planning.",
  },
  {
    problemId: "payment-system", title: "Payment System", focus: "creating a payment and recording its ledger state", table: "payments", columns: ["paymentId", "idempotencyKey", "amount", "currency", "status"], index: "idempotencyKey", readPath: "/payments/:id", writePath: "/payments", middle: "queue", middleFocus: "publish payment events for settlement and reconciliation", middleWhy: "The API can commit a payment state transition and publish follow-up work without making settlement providers part of the synchronous request path.", middleTradeoff: "Financial workflows need idempotency, durable audit trails, and explicit failure recovery; the queue model does not prove atomic database-plus-broker commits.", middleExtraSteps: [{
      id: "payment-system-medium-outbox-schema",
      title: "Model a transactional outbox",
      prompt: "In the SQL Database, create an outbox_events table with eventId, paymentId, eventType, payload, createdAt, and publishedAt; add an index on eventId. Explain how the payment update and outbox insert should be committed together before a separate relay publishes events.",
      why: "A transactional outbox stores the event intent alongside the business change in one database transaction, so a process crash after commit does not silently lose the event before publication.",
      tradeoff: "This step checks only the outbox schema and index. It does not verify a shared transaction, relay polling, publication retries, or duplicate handling; a relay still needs idempotent consumers.",
      objective: { kind: "database-schema", databaseComponentId: "sql-db", tableName: "outbox_events", columns: ["eventId", "paymentId", "eventType", "payload", "createdAt", "publishedAt"], indexedColumns: ["eventId"] },
    }], highComponent: "distributed-lock", highFocus: "discuss coordination around contested balance updates", highWhy: "A lock can serialize a narrowly scoped critical section when multiple operations compete for the same account state.", highTradeoff: "Locks can reduce throughput and introduce lease/fencing hazards; prefer transactional ledger constraints where they solve the invariant.",
  },
  {
    problemId: "ticket-booking", title: "Ticket Booking", focus: "searching events and reserving a limited seat", table: "reservations", columns: ["reservationId", "eventId", "seatId", "userId", "status"], index: "eventId", readPath: "/events/:id/seats", writePath: "/reservations", middle: "cache", middleFocus: "cache read-heavy event and seat-map data", middleWhy: "Many users inspect the same event before reserving. Caching read-only event metadata reduces repeated database reads while the reservation write remains authoritative.", middleTradeoff: "Never treat cached availability as a final seat allocation; a transaction or conditional write must decide the winner.", middleExtraSteps: [{
      id: "ticket-booking-medium-atomic-seat-claim",
      title: "Make the seat claim atomic",
      prompt: "Assume two requests read seat S for event E as available from cache at the same time. Each starts a SQL transaction, sees no active reservation, and inserts a different reservation row. State the invariant that a seat has at most one active reservation. Explain why the cache check alone does not enforce it. Compare a database-enforced invariant—such as uniqueness for active (eventId, seatId) reservations or a conditional seat-state update that succeeds for exactly one request—with a serializable transaction that may abort and require retry. Say what the losing request should do, and distinguish a temporary hold from final confirmation.",
      why: "Reading availability and claiming inventory are separate operations. The invariant must be enforced at the authoritative write boundary so concurrent requests cannot both win based on the same stale observation.",
      tradeoff: "This is a self-assessed design reflection. The simulator does not execute concurrent transactions, enforce SQL constraints, or model isolation levels; a transaction alone does not specify the invariant or retry behavior.",
      objective: { kind: "reflection", prompt: "Explain how the authoritative database makes a competing seat claim lose safely.", limitation: "The platform does not simulate concurrent writes, database constraints, or transaction isolation." },
    }], highComponent: "distributed-lock", highFocus: "reason about short-lived seat holds", highWhy: "A lease-based hold can temporarily prevent two users from paying for the same seat while the booking flow completes.", highTradeoff: "Expired locks, payment delays, and fencing tokens make correctness subtle; this component alone does not guarantee exactly-once booking.",
  },
  {
    problemId: "collaborative-editor", title: "Collaborative Editor", focus: "saving documents and distributing edits to collaborators", table: "document_snapshots", columns: ["documentId", "version", "contentRef", "updatedAt"], index: "documentId", readPath: "/documents/:id", writePath: "/documents/:id/snapshots", middle: "queue", middleFocus: "fan out edit events to connected collaborators", middleWhy: "A broker decouples accepted edits from downstream fan-out and snapshot work, allowing live collaboration and persistence consumers to scale independently.", middleTradeoff: "Operational Transformation and CRDT conflict resolution are not implemented by a queue; ordering and merge correctness must be specified separately.", highComponent: "websocket-server", highFocus: "keep collaborators connected for live updates", highWhy: "Persistent connections reduce polling overhead and let the service push document updates to active editors.", highTradeoff: "Per-document ordering, cursor presence, offline merge, and authorization on every event are not modeled here.",
  },
  {
    problemId: "file-storage", title: "File Storage", focus: "uploading file bytes and looking up file metadata", table: "files", columns: ["fileId", "ownerId", "objectKey", "version", "createdAt"], index: "ownerId", readPath: "/files/:id", writePath: "/files", extraCore: ["object-storage"], middle: "queue", middleFocus: "process file-change events asynchronously", middleWhy: "Virus scanning, thumbnails, and sync notifications can run after an upload is accepted, without holding the client request open for every downstream task.", middleTradeoff: "Chunk boundaries, content-addressed deduplication, conflict resolution, and resumable-upload semantics need separate protocols.", middleExtraSteps: [{
      id: "file-storage-medium-backup-restore",
      title: "Plan a consistent backup and restore",
      prompt: "Assume file metadata is stored in SQL and bytes in Object Storage. Choose scenario-specific recovery point objective (RPO) and recovery time objective (RTO); 15 minutes and 2 hours are examples, not defaults. Explain how the recovery set keeps metadata references aligned with object versions—for example, record exact object-version IDs in metadata, or quiesce writes and capture a coordinated manifest/watermark. Account for uploads and deletes in flight; separate database and object-store snapshots are not automatically atomic. Describe a restore drill into an isolated environment: restore referenced objects and metadata, reconcile missing or orphaned objects, verify checksums, measure restore time, and define cutover criteria. Explain why replicas alone are not backups.",
      why: "A service is recoverable only if its metadata and referenced bytes can be restored to a mutually usable point. Explicit RPO/RTO targets turn “we have backups” into loss and recovery expectations that can be tested in drills.",
      tradeoff: "This is a self-assessed design reflection. The simulator does not create backups, coordinate cross-store snapshots, restore data, or measure RPO/RTO. The example targets are not recommendations; recovery depends on workload, retention, object-version policy, credentials, encryption-key recovery, and tested procedures.",
      objective: { kind: "reflection", prompt: "Describe a tested restore plan that keeps file metadata and referenced object versions consistent.", limitation: "The platform does not simulate backups, cross-store snapshot consistency, restore drills, or RPO/RTO." },
    }], highComponent: "cdn", highFocus: "deliver frequently accessed files closer to readers", highWhy: "A CDN can cache public or safely shareable file content and reduce repeated origin reads.", highTradeoff: "Private files need authorization-aware signed delivery and careful cache keys; global invalidation and data residency are not modeled.", highEdge: ["cdn", "object-storage"], highExtra: ["object-storage"],
  },
  {
    problemId: "parking-lot", title: "Parking Lot System", focus: "finding availability and reserving a parking space", table: "parking_spots", columns: ["spotId", "facilityId", "status", "updatedAt"], index: "facilityId", readPath: "/facilities/:id/availability", writePath: "/reservations", middle: "cache", middleFocus: "cache facility availability summaries", middleWhy: "Availability boards receive frequent reads while spot changes are comparatively sparse; caching a summary can reduce repeated aggregation work.", middleTradeoff: "Availability is only a snapshot. Reservation must recheck and atomically claim a spot to avoid double booking.", highComponent: "stream-processor", highFocus: "aggregate occupancy sensor events", highWhy: "A stream processor can turn raw spot changes into facility-level occupancy counters and operational alerts.", highTradeoff: "Sensor loss, duplicate events, and demand forecasting require reconciliation and domain logic not modeled by the simulator.",
  },
  {
    problemId: "instagram", title: "Instagram / Photo Sharing", focus: "publishing image posts and reading a feed", table: "posts", columns: ["postId", "userId", "objectKey", "caption", "createdAt"], index: "userId", readPath: "/feed", writePath: "/posts", extraCore: ["object-storage"], middle: "queue", middleFocus: "transcode and fan out new media in the background", middleWhy: "Image derivatives and follower notifications take longer than accepting post metadata; queued workers can scale independently of the write API.", middleTradeoff: "Fan-out strategy and engagement-counter contention depend on follower skew; ranking models and media quality are not simulated.", highComponent: "cdn", highFocus: "serve popular media from edge caches", highWhy: "A CDN avoids fetching the same popular image from object storage for every viewer and reduces origin bandwidth.", highTradeoff: "Private content authorization, cache purge behavior, and personalized ranking need policies outside the aggregate simulation.", highEdge: ["cdn", "object-storage"], highExtra: ["object-storage"],
  },
  {
    problemId: "music-streaming", title: "Music Streaming", focus: "looking up tracks and delivering audio objects", table: "tracks", columns: ["trackId", "artistId", "objectKey", "duration", "publishedAt"], index: "artistId", readPath: "/tracks/:id", writePath: "/tracks", extraCore: ["object-storage"], middle: "cache", middleFocus: "cache hot track metadata and playback manifests", middleWhy: "Frequently played tracks and metadata are requested repeatedly; a cache can reduce database reads and improve the control-plane lookup path.", middleTradeoff: "Caching metadata does not deliver audio bytes or implement adaptive bitrate; audio segments belong in object storage/CDN delivery paths.", highComponent: "cdn", highFocus: "deliver audio segments near listeners", highWhy: "Edge caching reduces origin load and network distance for popular catalog audio.", highTradeoff: "Regional rights, offline synchronization, codec ladders, and segment eviction need product-specific logic beyond this model.", highEdge: ["cdn", "object-storage"], highExtra: ["object-storage"],
  },
  {
    problemId: "ecommerce", title: "E-Commerce", focus: "browsing a product catalog and placing orders", table: "orders", columns: ["orderId", "customerId", "status", "total", "createdAt"], index: "customerId", readPath: "/products", writePath: "/orders", middle: "cache", middleFocus: "cache popular product catalog reads", middleWhy: "Product detail and category pages are read-heavy and often repeated; caching reduces catalog database load while writes update inventory and orders through authoritative paths.", middleTradeoff: "Price and stock must not be trusted from stale cache at checkout; invalidation and conditional inventory updates need explicit design.", highComponent: "sharded-counter", highFocus: "spread hot inventory and product engagement updates", highWhy: "Popular products can create hot inventory and engagement keys. Sharding distributes update pressure and aggregates values for reads.", highTradeoff: "Aggregated counters can be briefly stale and must not replace an authoritative transactional inventory reservation.",
  },
  {
    problemId: "team-messaging", title: "Team Messaging", focus: "storing channel messages and notifying active members", table: "channel_messages", columns: ["workspaceId", "channelId", "messageId", "authorId", "createdAt"], index: "channelId", readPath: "/channels/:id/messages", writePath: "/channels/:id/messages", middle: "queue", middleFocus: "index and fan out messages asynchronously", middleWhy: "Search indexing, notifications, and channel fan-out are independent consumers; a broker prevents those tasks from slowing the message write path.", middleTradeoff: "Workspace partitioning, search relevance, and ordered thread materialization need additional partition and consistency policies.", highComponent: "websocket-server", highFocus: "push new channel messages to active clients", highWhy: "Persistent connections deliver updates without each client polling every channel for new messages.", highTradeoff: "Connection routing and workspace-level noisy-neighbor isolation are not covered by the graph or queue contracts.",
  },
  {
    problemId: "metrics-monitoring", title: "Metrics / Monitoring", focus: "ingesting measurements and querying recent service health", table: "metric_samples", columns: ["metricName", "labels", "value", "timestamp"], index: "timestamp", database: "timeseries-db", readPath: "/metrics/query", writePath: "/metrics/ingest", middle: "queue", middleFocus: "buffer telemetry ingestion before aggregation", middleWhy: "A broker absorbs bursts from many producers and lets aggregation workers batch and process samples independently of ingestion APIs.", middleTradeoff: "Queue buffering does not define retention, cardinality limits, or backpressure; those are central to time-series cost and reliability.", middleExtraSteps: [{
      id: "metrics-monitoring-medium-event-time-lateness",
      title: "Choose a policy for late metric events",
      prompt: "Design a 5-minute tumbling aggregation for metric_samples. Distinguish event time from processing time: a sample timestamped 10:04 belongs to the 10:00–10:05 event-time window even if it arrives after that window has been emitted; a processing-time window buckets by arrival. Choose an allowed-lateness policy (two minutes is only an example) and explain whether records within that allowance revise the dashboard result, while records beyond it are reconciled separately or dropped. Explain how alerts mark provisional versus corrected results, why a watermark estimates event-time progress rather than proving no older event can arrive, and how late-event handling differs from duplicate-event deduplication.",
      why: "Telemetry sources can buffer, retry, or deliver samples out of order. Event-time windows preserve the time the measurement describes, while an explicit lateness policy makes the trade-off between timely alerts and corrected historical aggregates visible.",
      tradeoff: "This is a self-assessed design reflection. The simulator does not model event timestamps, processing-time windows, watermarks, aggregation state, late-event correction, or alert finality. The lateness allowance is workload-specific, not a universal recommendation.",
      objective: { kind: "reflection", prompt: "Explain event time versus processing time and a late-data policy for a windowed metric.", limitation: "The platform does not simulate stream-processing windows, watermarks, or late events." },
    }], highComponent: "monitoring", highFocus: "observe ingestion lag and service health", highWhy: "The monitoring tier tracks queue lag, rejected samples, and service saturation so operators can detect a pipeline that is falling behind.", highTradeoff: "Monitoring the monitoring system requires independent alert paths; downsampling and anomaly detection are not verified here.",
  },
  {
    problemId: "netflix", title: "Netflix / Video Streaming", focus: "looking up titles and serving media objects", table: "titles", columns: ["titleId", "name", "objectKey", "availabilityRegion"], index: "titleId", readPath: "/titles/:id", writePath: "/titles", extraCore: ["object-storage"], middle: "cache", middleFocus: "cache popular title metadata and playback manifests", middleWhy: "Popular titles create repeated catalog and playback-control reads; caching those small responses avoids unnecessary origin lookups.", middleTradeoff: "Metadata caching does not model video bytes, adaptive bitrate, DRM, or regional CDN placement.", highComponent: "cdn", highFocus: "serve popular media from edge delivery", highWhy: "Edge delivery places frequently viewed segments closer to viewers and reduces pressure on the origin storage tier.", highTradeoff: "Open Connect placement, DRM license checks, and encoding-ladder optimization are conceptual and are not simulated.", highEdge: ["cdn", "object-storage"], highExtra: ["object-storage"],
  },
  {
    problemId: "tinder", title: "Tinder / Dating App", focus: "loading nearby profiles and recording swipes", table: "swipes", columns: ["userId", "profileId", "direction", "createdAt"], index: "userId", readPath: "/profiles/nearby", writePath: "/swipes", middle: "cache", middleFocus: "cache profile cards for active discovery sessions", middleWhy: "Discovery repeatedly loads candidate profiles; caching profile data reduces repeated reads while swipe decisions still persist to durable storage.", middleTradeoff: "A cached deck can become stale as location or preferences change; match detection and abuse prevention need separate correctness rules.", highComponent: "geospatial-index", highFocus: "filter candidates by proximity efficiently", highWhy: "A geospatial index supports radius queries without scanning every profile in the system.", highTradeoff: "Location privacy, geohash cell sizing, ranking, and candidate freshness require policy and algorithm work not represented here.",
  },
  {
    problemId: "google-maps", title: "Google Maps / Navigation", focus: "serving map data and calculating routes", table: "road_segments", columns: ["segmentId", "regionId", "geometry", "updatedAt"], index: "regionId", readPath: "/routes", writePath: "/traffic/updates", middle: "cache", middleFocus: "cache frequently requested map tiles and route data", middleWhy: "Popular geographic tiles and stable route data are repeatedly requested; caching reduces repeated origin and graph-store work.", middleTradeoff: "Live traffic invalidation and route freshness must be balanced against cache hit rate; routing algorithms and ETA accuracy are not simulated.", highComponent: "stream-processor", highFocus: "aggregate incoming traffic observations", highWhy: "A stream processor can turn location pings into rolling road-speed estimates without coupling ingestion to route queries.", highTradeoff: "Map matching, time windows, regional graph sharding, and multi-modal routing remain conceptual.",
  },
  {
    problemId: "zoom", title: "Zoom / Video Conferencing", focus: "creating meetings and connecting participants", table: "meetings", columns: ["meetingId", "hostId", "status", "createdAt"], index: "hostId", readPath: "/meetings/:id", writePath: "/meetings", middle: "queue", middleFocus: "process recordings and meeting lifecycle events asynchronously", middleWhy: "Recording, transcription, and notifications should not block meeting creation or participant connection setup.", middleTradeoff: "Real-time media packets do not flow through a generic message queue; this path represents control-plane events only.", highComponent: "websocket-server", highFocus: "maintain signaling connections for participants", highWhy: "A persistent signaling channel supports meeting setup and participant state changes without repeated polling.", highTradeoff: "SFU/MCU forwarding, simulcast adaptation, congestion control, and SRTP encryption are not modeled by this system-design simulator.",
  },
  {
    problemId: "food-delivery", title: "Food Delivery", focus: "placing an order and matching it with a courier", table: "orders", columns: ["orderId", "customerId", "restaurantId", "driverId", "status"], index: "status", readPath: "/restaurants/nearby", writePath: "/orders", middle: "queue", middleFocus: "dispatch accepted orders asynchronously", middleWhy: "Restaurant acceptance, courier assignment, and customer notifications have different latency and retry behavior; a queue decouples these workflows.", middleTradeoff: "Order state transitions still need idempotency and a durable source of truth; batching, ETA, and dispatch fairness are not simulated.", highComponent: "geospatial-index", highFocus: "find nearby restaurants and couriers", highWhy: "A geospatial index narrows proximity candidates before the dispatch service evaluates availability and suitability.", highTradeoff: "GPS freshness, multi-stop optimization, and supply-demand pricing require geographic and operational models beyond this graph.",
  },
  {
    problemId: "reddit", title: "Reddit / Social News", focus: "publishing posts and reading community feeds", table: "posts", columns: ["postId", "communityId", "authorId", "score", "createdAt"], index: "communityId", readPath: "/communities/:id/feed", writePath: "/posts", middle: "cache", middleFocus: "cache hot community feeds", middleWhy: "Popular communities generate repeated reads of similar feed pages; caching reduces repeated database and ranking work.", middleTradeoff: "Votes and new posts make feeds stale, so TTL and invalidation are product choices; ranking formulas and nested comment semantics are not modeled.", highComponent: "sharded-counter", highFocus: "spread hot vote and score updates", highWhy: "Sharding a hot score counter spreads write contention and allows eventual aggregation for feed display.", highTradeoff: "Aggregated scores may lag and ranking can change during pagination; exact ranking fairness is outside this lesson.",
  },
  {
    problemId: "airbnb", title: "Airbnb / Booking Platform", focus: "searching listings and reserving date ranges", table: "reservations", columns: ["reservationId", "listingId", "guestId", "checkIn", "checkOut", "status"], index: "listingId", readPath: "/listings/search", writePath: "/reservations", middle: "cache", middleFocus: "cache listing details and search metadata", middleWhy: "Listing descriptions and photos are read frequently while reservations change less often; caching can reduce catalog load.", middleTradeoff: "Availability must be revalidated at booking time. Cached calendars cannot prevent double booking without an authoritative transaction or reservation protocol.", highComponent: "distributed-lock", highFocus: "discuss temporary inventory holds", highWhy: "A short lease can reserve a listing while payment completes and reduce simultaneous booking conflicts.", highTradeoff: "Lease expiry, payment failure, and date-range overlap correctness are not solved by adding a lock component alone.",
  },
  {
    problemId: "whatsapp", title: "WhatsApp / Messaging", focus: "persisting messages and delivering them to devices", table: "messages", columns: ["conversationId", "messageId", "senderId", "createdAt"], index: "conversationId", readPath: "/conversations/:id/messages", writePath: "/conversations/:id/messages", middle: "queue", middleFocus: "store and forward messages to offline devices", middleWhy: "A broker lets message acceptance, offline delivery, and multi-device fan-out progress independently.", middleTradeoff: "Delivery acknowledgements and deduplication require message IDs and per-device state; this does not implement Signal Protocol or end-to-end encryption.", highComponent: "websocket-server", highFocus: "push messages to connected devices", highWhy: "Persistent connections lower delivery delay for active recipients and avoid repeated client polling.", highTradeoff: "Per-conversation ordering, receipt state machines, key exchange, and encryption are protocol concerns outside this simulator.",
  },
  {
    problemId: "search-engine", title: "Search Engine", focus: "accepting documents and serving search queries", table: "documents", columns: ["documentId", "url", "title", "contentRef", "indexedAt"], index: "url", readPath: "/search", writePath: "/documents", extraCore: ["object-storage"], middle: "queue", middleFocus: "index document changes asynchronously", middleWhy: "Document ingestion and query serving have different workloads. A queue lets indexers consume changes in batches without blocking crawlers or content writers.", middleTradeoff: "The index can lag behind source data; shard placement, BM25 tuning, PageRank, and spell correction are not validated by the graph.", highComponent: "search", highFocus: "make the query index an explicit serving tier", highWhy: "A dedicated search service can serve inverted-index queries without scanning the canonical document store.", highTradeoff: "Index freshness, shard fan-out, ranking quality, and query scatter-gather costs require workload benchmarks.", highExtraSteps: [{
      id: "search-engine-high-schema-evolution",
      title: "Roll out a document schema change safely",
      prompt: "Add a language field and a new search analyzer without requiring an all-at-once migration. Plan an expand-and-contract rollout: make readers tolerate both old and new representations, deploy compatible writers (including dual-writing where needed), backfill/reindex existing documents in resumable batches, measure coverage and query quality, switch reads only when safe, then remove the old representation after a rollback window. Explain how malformed, missing, or partially migrated documents are handled and how you can stop or resume the backfill.",
      why: "Stored documents and search indexes often outlive one application deployment. A staged migration lets old and new versions coexist while existing data is transformed, making rollout and rollback risks explicit.",
      tradeoff: "This is a self-assessed migration plan. The simulator does not model mixed-version compatibility, schema validation over document populations, backfill completeness, analyzer/index correctness, query quality, or rollback safety.",
      objective: { kind: "reflection", prompt: "Describe a resumable expand-and-contract document/index migration with a rollback point.", limitation: "The platform does not simulate schema evolution, reindexing, or mixed-version deployments." },
    }],
  },
  {
    problemId: "location-service", title: "Location-Based Service", focus: "finding nearby businesses and returning useful details", table: "businesses", columns: ["businessId", "name", "category", "location", "rating"], index: "category", readPath: "/businesses/nearby", writePath: "/businesses", middle: "cache", middleFocus: "cache popular nearby-search results", middleWhy: "Frequently searched neighborhoods and categories can reuse result pages, reducing repeated database and geo-query work.", middleTradeoff: "Location changes and ratings can make cached results stale; cache keys must include the query region and filters.", highComponent: "geospatial-index", highFocus: "support proximity and radius filtering", highWhy: "A geospatial index narrows candidate businesses by location before category and relevance filters are applied.", highTradeoff: "QuadTree/geohash partitioning, ranking weights, and location privacy are not verified by this model.",
  },
  {
    problemId: "tiktok", title: "TikTok / Short Video", focus: "publishing short videos and serving a personalized feed", table: "videos", columns: ["videoId", "creatorId", "objectKey", "status", "createdAt"], index: "creatorId", readPath: "/feed", writePath: "/videos", extraCore: ["object-storage"], middle: "queue", middleFocus: "transcode and moderate uploads asynchronously", middleWhy: "Transcoding and moderation are resource-heavy tasks that can run after the upload is accepted, with workers scaled independently.", middleTradeoff: "Moderation false positives, encoding profiles, and recommendation quality require separate models and are not inferred from queue throughput.", highComponent: "stream-processor", highFocus: "aggregate watch and engagement events", highWhy: "A stream processor can maintain rolling popularity signals from view, completion, and interaction events for downstream feed generation.", highTradeoff: "Two-tower recommendation, user embeddings, content safety policy, and ranking freshness are conceptual rather than simulated.",
  },
  {
    problemId: "message-queue-design", title: "Message Queue Design", focus: "accepting records and delivering them to consumer groups", table: "consumer_offsets", columns: ["groupId", "topic", "partitionId", "offset", "updatedAt"], index: "groupId", database: "nosql-db", readPath: "/consumer-groups/:id/offsets", writePath: "/topics/:topic/messages", middle: "queue", middleFocus: "define topic subscriptions and competing consumers", middleWhy: "Topics decouple producers from consumers, and competing consumers allow work to be distributed across a consumer group.", middleTradeoff: "Partition assignment, offset commits, replay, and ordering guarantees are broker semantics; a graph-level queue contract cannot prove them.", middleExtraSteps: [{
      id: "message-queue-design-medium-idempotency-record",
      title: "Design for safe message reprocessing",
      prompt: "Create a processed_messages table in the NoSQL Database with messageId and processedAt, and add an index on messageId. Explain how a consumer could use the message ID to recognize a redelivery before applying its effect.",
      why: "At-least-once delivery can invoke a consumer more than once. A durable record keyed by message identity is a useful building block for deduplication and makes the data requirement explicit.",
      tradeoff: "This step verifies only the record schema and index. It does not model an atomic claim, transaction with the business effect, offset commit, or exactly-once processing; those guarantees require additional design.",
      objective: { kind: "database-schema", databaseComponentId: "nosql-db", tableName: "processed_messages", columns: ["messageId", "processedAt"], indexedColumns: ["messageId"] },
    }, {
      id: "message-queue-design-medium-checkpoint-boundary",
      title: "Choose a safe consumer checkpoint boundary",
      prompt: "For each consumer group and topic partition, reason about a checkpoint representing the next offset to process. Compare committing before the durable business effect (a crash can skip work) with applying the effect before committing (a crash can cause redelivery and duplicate effects). With concurrent processing, advance only through the contiguous completed offset prefix; discuss atomic effect-plus-checkpoint transactions where available and idempotency otherwise.",
      why: "Checkpoint position determines which records a consumer may resume from. The ordering between effects and checkpoint commits creates the classic loss-versus-duplicate crash window, and out-of-order completion must not let a checkpoint pass unfinished work.",
      tradeoff: "This is a self-assessed design reflection. The simulator has no message offsets, processing timeline, acknowledgments, or crash/restart state; it cannot verify checkpoint correctness or guarantee exactly-once effects.",
      objective: { kind: "reflection", prompt: "Explain the checkpoint commit order and contiguous-prefix rule for concurrent processing.", limitation: "The platform does not simulate offsets, acknowledgments, or crash/restart behavior." },
    }, {
      id: "message-queue-design-medium-recovery-window",
      title: "Choose a message recovery window",
      prompt: "Set the message-queue-design-events topic retention to at least 72 hours. Treat 72 hours as this scenario's recovery assumption, and explain why retained messages can help recover a consumer or rebuild derived state.",
      why: "Retention defines how long a broker may keep records available for consumers to recover from an outage or replay history for a derived view.",
      tradeoff: "The 72-hour target is a scenario choice, not a universal recommendation. This objective checks only configured retention; it does not simulate offset rewind, replay throughput, storage limits, or exactly-once effects.",
      objective: { kind: "queue-retention", queueComponentId: "message-queue", topicName: "message-queue-design-events", minimumRetentionHours: 72 },
    }, {
      id: "message-queue-design-medium-partition-parallelism",
      title: "Match partitions to consumer parallelism",
      prompt: "Set message-queue-design-events to at least four partitions, estimate 50% of its traffic on the busiest partition, and enter 2048 bytes as its illustrative average message size. Compare the partition count with Stream Processor replicas, then run the medium scenario and inspect the topic-level projected backlog and logical payload estimate as well as how skew changes backlog versus a uniform 25% share. Explain why too few partitions or a hot partition can limit useful parallelism.",
      why: "Partitions provide independently consumable work units in common log-based brokers. More consumer replicas than partitions can leave replicas idle, while a hot partition can constrain progress even when aggregate consumer capacity remains.",
      tradeoff: "The simulator uses partition count and the optional hottest-partition share only as a directional competing-consumer backlog estimate. It does not model keyed assignment, actual partition placement, rebalancing, per-partition ordering, offsets, or broker-specific throughput guarantees.",
      objective: { kind: "queue-partitions", queueComponentId: "message-queue", topicName: "message-queue-design-events", minimumPartitions: 4, minimumHotPartitionTrafficShare: 0.5, minimumEstimatedAverageMessageSizeBytes: 2048 },
    }], highComponent: "coordination-service", highFocus: "coordinate broker membership and leadership", highWhy: "A coordination service can track membership and leadership for a distributed broker cluster.", highTradeoff: "Consensus and rebalancing behavior are conceptual; replication count alone does not establish durable or exactly-once delivery.", highExtraSteps: [{
      id: "message-queue-design-high-replication-tradeoffs",
      title: "Compare replication acknowledgments",
      prompt: "Assume a fixed replica set of N = 3. Compare asynchronous acknowledgment with a quorum policy such as W = 2 and R = 2, where W + R > N. Discuss write latency, write availability during replica failures, and stale-read or acknowledged-write-loss risk; name the assumptions behind quorum intersection.",
      why: "Replication policy trades off the time a producer waits for durability evidence against how much work may be lost or become unavailable during failures. Read/write quorum overlap is a useful reasoning tool under a fixed replica-set assumption.",
      tradeoff: "This is a self-assessed interview reflection. The simulator does not model broker replicas, quorum acknowledgments, concurrent-write resolution, failover freshness, or data loss; W + R > N alone is not a universal consistency guarantee.",
      objective: { kind: "reflection", prompt: "Compare asynchronous acknowledgment with W = 2, R = 2 for N = 3.", limitation: "The platform does not simulate replication or quorum behavior." },
    }, {
      id: "message-queue-design-high-client-consistency-contracts",
      title: "Define client-visible consistency guarantees",
      prompt: "Assume one partition has ordered writes “created” then “paid.” Define four distinct guarantees: read-your-writes means a client's later read reflects its acknowledged write; monotonic reads mean that client's later reads do not regress to an older version; consistent prefix means an observer sees a prefix of the same history and never sees “paid” without “created”; linearizability means operations appear atomic in an order respecting real-time precedence, so a read invoked after a completed write sees it or a later write. Discuss how session routing or version/read barriers, ordered replication, and an appropriate consensus-backed read/write protocol might help. Explain why session guarantees do not establish one global real-time order, and why sticky routing or W + R > N alone does not establish linearizability.",
      why: "Replication mechanisms matter because of what clients can observe. Naming the guarantee clarifies whether a design needs per-session continuity, a common ordered history, or a single real-time-respecting order across clients.",
      tradeoff: "This is a self-assessed design reflection. The simulator does not model client-observed consistency, version barriers, replica reads, ordered replication, or consensus protocols; quorum overlap alone does not prove linearizability or guarantee freshness.",
      objective: { kind: "reflection", prompt: "Distinguish read-your-writes, monotonic reads, consistent prefix, and linearizability.", limitation: "The platform does not simulate or verify client-visible consistency guarantees." },
    }, {
      id: "message-queue-design-high-failure-domain-placement",
      title: "Place replicas across failure domains",
      prompt: "Assume three replicas for one partition. Compare placing all replicas in one rack or zone with spreading them across three independent zones. Under the acknowledgment policy you considered, reason about a single-domain failure and a two-domain failure: which replicas and quorum responses may remain, and what service or data risks persist? Include cross-zone latency and cost, plus one common dependency or network-partition caveat. Explain why replica count alone does not establish availability or durability.",
      why: "Replicas protect against failures only to the extent their failure modes are independent. Placement, correlated dependencies, network reachability, and acknowledgment policy jointly determine what can continue after a fault.",
      tradeoff: "This is a self-assessed design reflection. The simulator does not model replica placement, correlated failures, network partitions, quorum availability, or failover; spreading replicas does not by itself guarantee service or data safety.",
      objective: { kind: "reflection", prompt: "Compare same-domain and cross-zone replica placement under failures and quorum policy.", limitation: "The platform does not simulate failure domains, correlated faults, or quorum availability." },
    }, {
      id: "message-queue-design-high-retry-estimate",
      title: "Estimate bounded delivery retries",
      prompt: "For message-queue-design-events, enter an illustrative 10% independent failure probability per delivery attempt, up to three additional retries, and a fixed 250 ms delay before each retry. Run the high scenario and inspect estimated total attempts, retry attempts, successful deliveries, exhausted deliveries per second, and expected retry wait per modeled delivery. Explain why retries can amplify work and why a separate dead-letter policy is needed for exhausted messages.",
      why: "A bounded retry estimate makes the potential extra attempt volume and residual failure fraction visible from explicit assumptions, without pretending to execute a broker or consumer.",
      tradeoff: "This is a post-hoc estimate based on independent, constant failure probability and an optional fixed delay per retry; the delay is not an executed schedule. It does not feed retry work back into consumer capacity, throughput, latency, or backlog, and it does not simulate acknowledgments, offsets, exponential backoff, DLQ routing, ordering, duplicate effects, or delivery guarantees.",
      objective: { kind: "queue-retry-estimate", queueComponentId: "message-queue", topicName: "message-queue-design-events", assumedFailureRatePerAttempt: 0.1, minimumMaxDeliveryRetries: 3, assumedRetryBackoffMs: 250 },
    }, {
      id: "message-queue-design-high-dead-letter-policy",
      title: "Contain poison messages safely",
      prompt: "Design a consumer failure policy: use bounded retries with backoff, then quarantine a repeatedly failing message in a dead-letter queue with its original message ID, topic, partition, offset, failure reason, and timestamps. Decide how operators alert, repair, and replay it; consider whether moving it aside is safe when later records depend on partition order, and keep effects idempotent on replay.",
      why: "Unbounded retries can let one poison message consume capacity or block progress. A bounded retry and dead-letter policy makes failures visible and gives operators a controlled recovery path, while preserving enough context to investigate and replay safely.",
      tradeoff: "This is a self-assessed design reflection. The simulator does not execute consumer retries, backoff, dead-letter routing, partition blocking, alerts, or replay; it cannot establish delivery guarantees.",
      objective: { kind: "reflection", prompt: "Describe bounded retries, dead-letter handling, and safe replay for a poison message.", limitation: "The platform does not simulate consumer retry or dead-letter behavior." },
    }],
  },
  {
    problemId: "digital-wallet",
    title: "Digital Wallet",
    focus: "checking balances and transferring value",
    table: "ledger_entries",
    columns: ["entryId", "walletId", "transactionId", "amount", "currency", "createdAt"],
    index: "transactionId",
    readPath: "/wallets/:id/balance",
    writePath: "/transfers",
    middle: "queue",
    middleFocus: "publish transfer events for settlement and reconciliation",
    middleWhy: "Asynchronous downstream settlement and notifications can proceed after a durable transfer state transition rather than extending the user-facing request.",
    middleTradeoff: "Ledger invariants require atomic debit/credit handling and idempotency. A queue does not create an atomic transaction across services.",
    middleExtraSteps: [{
      id: "digital-wallet-medium-transfer-boundary",
      title: "Preserve the transfer invariant across boundaries",
      prompt: "For a same-currency transfer, state the invariant: a committed transfer has equal debit and credit entries and cannot leave a partial committed transfer or overspend the source wallet. If both wallets share a SQL transaction boundary, explain atomic ledger writes and how concurrent debits are guarded. If they are on different shards or services, explain how separate local commits can leave a partial transfer; compare a distributed transaction with a saga or reservation state machine. Identify the pending state and recovery path, and why compensation is not an instantaneous rollback.",
      why: "The transaction boundary should match the invariant being protected. Moving accounts across boundaries changes the failure and recovery problem; an outbox can reliably publish intent but does not make the debit and credit atomic across services.",
      tradeoff: "This is a self-assessed design reflection. The platform does not execute transactions or model isolation, atomic commit, concurrent balance updates, sagas, or cross-shard consistency; it cannot verify financial correctness.",
      objective: { kind: "reflection", prompt: "Explain the transfer invariant and recovery strategy when both entries cannot share one local transaction.", limitation: "The platform does not simulate transaction isolation or cross-boundary commit/recovery." },
    }],
    highComponent: "distributed-lock",
    highFocus: "analyze contention on shared wallet state",
    highWhy: "A narrowly scoped lock can serialize conflicting updates when the transaction design cannot rely solely on conditional database writes.",
    highTradeoff: "Lock failure and lease safety can threaten financial correctness; prefer an immutable double-entry ledger and transactional constraints where possible.",
    highExtraSteps: [{
      id: "digital-wallet-high-replica-read-policy",
      title: "Choose a safe balance-read policy",
      prompt: "Assume balance reads may be served by the primary or by asynchronously replicated read replicas. Explain how replica lag can make a just-completed credit appear missing, and how routing a client's read to the primary or using an appropriate version/read barrier can support read-your-writes. Explain why a stale balance read must never authorize a debit: enforce the balance invariant at the authoritative transactional write boundary. Compare primary-only reads with replica reads for freshness, read scaling, latency, and failure handling. Then compare asynchronous replication with a synchronous policy, noting the engine-specific acknowledgment, durability, and availability behavior that must be verified before claiming an RPO.",
      why: "Read replicas can increase read capacity, but a replication policy defines when acknowledged writes become visible and what happens during failure. Financial decisions must use an authoritative concurrency-safe write, not rely on a potentially stale display read.",
      tradeoff: "This is a self-assessed design reflection. The simulator's read-replica count is only a capacity estimate; it does not model primary/replica routing, lag, read-your-writes, synchronous acknowledgment, failover, or data loss. Replication guarantees vary by database and configuration.",
      objective: { kind: "reflection", prompt: "Explain how to preserve read-your-writes and enforce balance invariants when replica reads may be stale.", limitation: "The platform does not simulate database replication, lag, consistency, or failover." },
    }],
  },
  {
    problemId: "code-editor", title: "Online Code Editor", focus: "saving project files and running code safely", table: "projects", columns: ["projectId", "ownerId", "objectKey", "language", "updatedAt"], index: "ownerId", readPath: "/projects/:id", writePath: "/projects/:id/files", extraCore: ["object-storage"], middle: "queue", middleFocus: "dispatch code execution to isolated workers", middleWhy: "Compilation and execution are variable, resource-intensive jobs; queuing them keeps editor APIs responsive and gives workers a separate scaling boundary.", middleTradeoff: "A queue does not sandbox untrusted code. Container isolation, CPU/memory limits, network policy, and cleanup must be enforced by an execution platform.", highComponent: "task-scheduler", highFocus: "manage execution lifecycle and timeouts", highWhy: "A scheduler can coordinate delayed cleanup, job timeouts, and retryable background tasks around execution workers.", highTradeoff: "Cold starts, snapshots, language images, and sandbox escape resistance require dedicated runtime engineering and security review.",
  },
  {
    problemId: "cicd-pipeline", title: "CI/CD Pipeline", focus: "accepting build jobs and storing their artifacts", table: "builds", columns: ["buildId", "repository", "commitSha", "status", "createdAt"], index: "repository", readPath: "/builds/:id", writePath: "/builds", extraCore: ["object-storage"], middle: "queue", middleFocus: "dispatch builds to independent workers", middleWhy: "Build duration varies by repository and test suite; a queue buffers submissions and lets runner capacity scale independently from the control-plane API.", middleTradeoff: "Queue dispatch does not model dependency DAG scheduling, cache correctness, or artifact provenance; workers need idempotent job handling.", highComponent: "task-scheduler", highFocus: "coordinate pipeline stages and retries", highWhy: "A scheduler can track job dependencies, retry policies, timeouts, and deployment stages across a multi-step pipeline.", highTradeoff: "Canary analysis, rollback thresholds, dependency resolution, and runner isolation are not simulated by the scheduler node.",
  },
];

const COMPONENT_LABELS: Record<string, string> = {
  "load-balancer": "Load Balancer",
  "api-gateway": "API Gateway",
  "app-server": "App Server",
  "sql-db": "SQL Database",
  "nosql-db": "NoSQL Database",
  "timeseries-db": "Time-Series Database",
  "object-storage": "Object Storage",
  "message-queue": "Message Queue",
  "stream-processor": "Stream Processor",
  "rate-limiter": "Rate Limiter",
  "sharded-counter": "Sharded Counter",
  "websocket-server": "WebSocket Server",
  "notification-service": "Notification Service",
  "search": "Search Service",
  "distributed-lock": "Distributed Lock",
  "coordination-service": "Coordination Service",
  "geospatial-index": "Geospatial Index",
  "cdn": "CDN",
  "monitoring": "Monitoring",
  "task-scheduler": "Task Scheduler",
};

const componentLabel = (componentId: string) => COMPONENT_LABELS[componentId] ?? componentId;

function pathEdges(database: string, extraCore: string[] = []) {
  return [
    { sourceComponentId: "load-balancer", targetComponentId: "api-gateway" },
    { sourceComponentId: "api-gateway", targetComponentId: "app-server" },
    { sourceComponentId: "app-server", targetComponentId: database },
    ...extraCore.map((componentId) => ({ sourceComponentId: "app-server", targetComponentId: componentId })),
  ];
}

function makeTrack(spec: TrackSpec): SystemTutorial {
  const problem = PROBLEMS.find((item) => item.id === spec.problemId);
  const highQps = Math.min(MAX_SIMULATION_QPS, Math.max(problem?.requirements.readsPerSec ?? 5_000, problem?.requirements.writesPerSec ?? 5_000));
  const lowQps = Math.max(MIN_SIMULATION_QPS, Math.ceil(highQps * 0.01));
  const mediumQps = Math.max(lowQps + 1, Math.ceil(highQps * 0.1));
  const database = spec.database ?? "sql-db";
  const extraCore = spec.extraCore ?? [];
  const readTarget = `${spec.table}.${spec.index}`;
  const writeTarget = `${spec.table}.${spec.columns.join(",")}`;
  const lowSteps: TutorialStep[] = [
    {
      id: `${spec.problemId}-low-path`,
      title: "Build the first request path",
      prompt: `Add Load Balancer → API Gateway → App Server → ${componentLabel(database)}${extraCore.length ? `, plus ${extraCore.map(componentLabel).join(" and ")}` : ""}. Connect the request path and each App Server storage dependency. This is the starting architecture for ${spec.focus}.`,
      why: `The load balancer and gateway provide a controlled entry path, the app server owns business rules for ${spec.focus}, and ${componentLabel(database)} keeps the authoritative records${extraCore.length ? ` while ${extraCore.map(componentLabel).join(" and ")} store large or specialized data` : ""}.`,
      tradeoff: "One service and one primary database are easier to operate at low load, but every read and write now shares those capacity and availability boundaries.",
      hint: "Add the components from the palette and connect the nodes directly in the requested order.",
      objective: {
        kind: "components-and-edges",
        components: ["load-balancer", "api-gateway", "app-server", database, ...extraCore].map((componentId) => ({ componentId })),
        edges: pathEdges(database, extraCore),
      },
    },
    {
      id: `${spec.problemId}-low-api`,
      title: "Define the read and write contracts",
      prompt: `On App Server, define GET ${spec.readPath} to read ${readTarget}, and POST ${spec.writePath} to write ${writeTarget}. Add matching API Gateway routes to the App Server.`,
      why: "Explicit request contracts make the service boundary and its database access visible. A named lookup key gives the read path a concrete access pattern to optimize later.",
      tradeoff: "A single service can own both operations initially; splitting read and write services before measuring workload differences adds deployment and consistency costs.",
      objective: {
        kind: "endpoint-contracts",
        serviceComponentId: "app-server",
        gatewayComponentId: "api-gateway",
        contracts: [
          { method: "GET", path: spec.readPath, steps: [{ kind: "database-read", targetComponentId: database, target: readTarget }] },
          { method: "POST", path: spec.writePath, steps: [{ kind: "database-write", targetComponentId: database, target: writeTarget }] },
        ],
      },
    },
    {
      id: `${spec.problemId}-low-schema`,
      title: "Model the durable records",
      prompt: `On ${componentLabel(database)}, create a ${spec.table} table with ${spec.columns.join(", ")}; add an index on ${spec.index} for the lesson's main lookup.`,
      why: `The schema documents the data required for ${spec.focus}, and the ${spec.index} index makes the expected lookup explicit instead of relying on a full scan.`,
      tradeoff: "Indexes consume storage and add write amplification. Add them for observed query patterns rather than indexing every field.",
      objective: { kind: "database-schema", databaseComponentId: database, tableName: spec.table, columns: spec.columns, indexedColumns: [spec.index] },
    },
    {
      id: `${spec.problemId}-low-baseline`,
      title: "Run the low-traffic baseline",
      prompt: `Run the ${lowQps.toLocaleString()} requests/sec scenario and inspect the request path, accepted throughput, and any component bottleneck before introducing a scaling layer.`,
      why: "A baseline gives you a reference point for the cache, queue, and capacity changes later in the tutorial.",
      tradeoff: "This deterministic estimate models aggregate component capacity; it does not predict production latency percentiles or domain-specific correctness.",
      objective: { kind: "simulation-checkpoint", requestsPerSec: lowQps },
    },
  ];

  const mediumSteps: TutorialStep[] = spec.middle === "cache"
    ? [
        {
          id: `${spec.problemId}-medium-cache`,
          title: "Add a cache-aside read path",
          prompt: `Add Cache / Redis and connect App Server → Cache. Add a cache-read step targeting that cache to GET ${spec.readPath}; retain the database read as the miss path. Set a default TTL of 300 seconds.`,
          why: spec.middleWhy,
          tradeoff: spec.middleTradeoff,
          hint: "Configure the cache operation on the endpoint in Props, then configure the cache node's default TTL.",
          objective: { kind: "cache-behavior", serviceComponentId: "app-server", cacheComponentId: "cache", readEndpoint: { method: "GET", path: spec.readPath }, writeEndpoint: { method: "POST", path: spec.writePath }, ttlSeconds: 300, requireInvalidation: false },
        },
        {
          id: `${spec.problemId}-medium-invalidation`,
          title: "Keep mutable records coherent",
          prompt: `Add a cache-invalidate step to POST ${spec.writePath}, targeting the same cache used by the read endpoint.`,
          why: "If a write changes data represented in a cached response, invalidation prevents the application from serving that entry until its TTL expires.",
          tradeoff: "Synchronous invalidation adds work to writes and can fail independently; TTL-only expiry is simpler but permits bounded staleness.",
          objective: { kind: "cache-behavior", serviceComponentId: "app-server", cacheComponentId: "cache", readEndpoint: { method: "GET", path: spec.readPath }, writeEndpoint: { method: "POST", path: spec.writePath }, ttlSeconds: 300, requireInvalidation: true },
        },
      ]
    : [
        {
          id: `${spec.problemId}-medium-queue`,
          title: "Move background work off the request path",
          prompt: `Add a Message Queue and Stream Processor. Create the topic ${spec.problemId}-events, subscribe the processor in competing-consumer mode, add a publish-event step to the existing POST ${spec.writePath} endpoint, and connect App Server → Queue → Processor with an asynchronous producer edge. Use it for this lesson's job: ${spec.middleFocus}.`,
          why: spec.middleWhy,
          tradeoff: spec.middleTradeoff,
          hint: "Configure the topic and consumer subscription on the queue, the publish operation on App Server, and mark the App Server → Queue edge asynchronous.",
          objective: { kind: "queue-contract", serviceComponentId: "app-server", queueComponentId: "message-queue", consumerComponentId: "stream-processor", topicName: `${spec.problemId}-events`, producerEndpoint: { method: "POST", path: spec.writePath }, deliveryMode: "competing", requireAsync: true },
        },
        {
          id: `${spec.problemId}-medium-worker-scale`,
          title: "Scale consumers independently",
          prompt: "Increase Stream Processor replicas to at least two. Explain whether worker capacity or the producer API is more likely to limit background completion first.",
          why: "Independent consumers let processing capacity grow without multiplying every synchronous API instance.",
          tradeoff: "Adding workers does not fix a slow dependency or preserve per-key ordering automatically; real consumer groups need partition and retry policies.",
          objective: { kind: "replicas", components: [{ componentId: "stream-processor", minimum: 2 }] },
        },
      ];
  mediumSteps.push(...(spec.middleExtraSteps ?? []));
  mediumSteps.push({
    id: `${spec.problemId}-medium-app-scale`,
    title: "Scale the synchronous service tier",
    prompt: "Increase App Server replicas to at least two. Explain whether the API or the newly added cache/worker tier should be monitored as the next bottleneck.",
    why: "Stateless application instances can process independent requests in parallel, but their downstream dependencies still impose separate limits.",
    tradeoff: "More replicas add cost and may not improve throughput if storage, cache, or consumer capacity is already saturated.",
    objective: { kind: "replicas", components: [{ componentId: "app-server", minimum: 2 }] },
  });
  mediumSteps.push({
    id: `${spec.problemId}-medium-baseline`,
    title: "Compare the medium-load design",
    prompt: `Run the ${mediumQps.toLocaleString()} requests/sec scenario and compare accepted throughput, bottlenecks, and projected queue backlog (if this lesson uses a queue) with the low-load baseline.`,
    why: "The checkpoint helps you connect the cache or asynchronous boundary to the aggregate behavior the simulator actually models.",
    tradeoff: "The simulator is a deterministic aggregate estimator; it does not prove cache coherence, queue time-series behavior, or production latency percentiles.",
    objective: { kind: "simulation-checkpoint", requestsPerSec: mediumQps },
  });

  const highEdge = spec.highEdge ?? ["app-server", spec.highComponent];
  const highSteps: TutorialStep[] = [
    {
      id: `${spec.problemId}-high-extension`,
      title: "Add a system-specific scale boundary",
      prompt: `Ensure ${componentLabel(spec.highComponent)}${spec.highExtra?.length ? ` and ${spec.highExtra.map(componentLabel).join(" and ")}` : ""} are present in the design. Connect ${componentLabel(highEdge[0])} → ${componentLabel(highEdge[1])} and use this boundary to ${spec.highFocus}.`,
      why: spec.highWhy,
      tradeoff: spec.highTradeoff,
      hint: "The graph can verify that the tier is present and wired; the advanced algorithm or operational guarantee remains a design discussion.",
      objective: { kind: "components-and-edges", components: [spec.highComponent, ...(spec.highExtra ?? [])].map((componentId) => ({ componentId })), edges: [{ sourceComponentId: highEdge[0], targetComponentId: highEdge[1] }] },
    },
    {
      id: `${spec.problemId}-high-capacity`,
      title: "Add headroom to the synchronous service",
      prompt: "Increase App Server replicas to at least two. Run the high-traffic scenario and identify whether the service, database, cache, or asynchronous consumer is the next capacity boundary.",
      why: "Horizontal service capacity helps only when downstream dependencies can keep up; compare every tier instead of assuming replicas solve all bottlenecks.",
      tradeoff: "Replica multiplication is a simplified estimate. It does not model database partitioning, shared-state contention, regional failure, or uneven key popularity.",
      objective: { kind: "replicas", components: [{ componentId: "app-server", minimum: 2 }] },
    },
    {
      id: `${spec.problemId}-high-simulation`,
      title: "Inspect the high-traffic result",
      prompt: `Run the ${highQps.toLocaleString()} requests/sec scenario on the current design. Compare offered and accepted traffic, bottlenecks, and queue backlog if present; state one assumption that must be validated before production.`,
      why: "The final checkpoint connects architecture choices to the simulator's observable aggregate outcome and asks you to distinguish modeled facts from operational assumptions.",
      tradeoff: "This is not a production SLO or proof of correctness. Domain-specific behavior such as ranking, geospatial accuracy, transactions, encryption, or adaptive delivery may remain conceptual.",
      objective: { kind: "simulation-checkpoint", requestsPerSec: highQps },
    },
  ];
  highSteps.splice(1, 0, ...(spec.highExtraSteps ?? []));

  const levels: [TutorialLevel, TutorialLevel, TutorialLevel] = [
    { id: "low", title: "Build the essential system", trafficLabel: `Low traffic · ${lowQps.toLocaleString()} requests/sec`, requestsPerSec: lowQps, goal: `Build the smallest durable architecture for ${spec.focus}.`, steps: lowSteps },
    { id: "medium", title: "Separate hot paths and background work", trafficLabel: `Medium traffic · ${mediumQps.toLocaleString()} requests/sec`, requestsPerSec: mediumQps, goal: `Reduce repeated work or decouple long-running work for ${spec.focus}.`, steps: mediumSteps },
    { id: "high", title: "Scale and inspect the design", trafficLabel: `High traffic · ${highQps.toLocaleString()} requests/sec`, requestsPerSec: highQps, goal: `Add a system-specific scaling boundary for ${spec.focus} and examine its trade-offs.`, steps: highSteps },
  ];
  return {
    problemId: spec.problemId,
    learningObjectives: [
      `Model the main request and data path for ${spec.focus}.`,
      `Explain the cost and consistency trade-offs of ${spec.middle === "cache" ? "caching" : "asynchronous processing"} as traffic grows.`,
      `Distinguish simulator-verified topology and capacity from domain guarantees that need separate design.`,
      `Interpret the per-problem traffic checkpoints as scaled scenarios derived from its stated read/write workload.`,
    ],
    levels,
  };
}

export const ADDITIONAL_SYSTEM_TUTORIALS = specs.map(makeTrack);
