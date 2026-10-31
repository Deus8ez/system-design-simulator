import type { SystemTutorial, TutorialLevel, TutorialStep } from "@/types/tutorial";

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
  highComponent: string;
  highFocus: string;
  highWhy: string;
  highTradeoff: string;
  highEdge?: [string, string];
  highExtra?: string[];
};

const specs: TrackSpec[] = [
  {
    problemId: "twitter-feed", title: "Twitter / News Feed", focus: "posting and reading a personalized timeline", table: "posts", columns: ["postId", "authorId", "body", "createdAt"], index: "authorId", readPath: "/timeline", writePath: "/posts", middle: "queue", middleFocus: "fan out new posts asynchronously", middleWhy: "A queue separates post acceptance from timeline fan-out, so follower delivery can scale independently and celebrity posts do not block the write API.", middleTradeoff: "Fan-out-on-write speeds ordinary reads but amplifies writes; high-follower accounts need a hybrid or read-time merge, which remains a design discussion here.", highComponent: "sharded-counter", highFocus: "protect engagement counts from hot-key writes", highWhy: "A sharded counter spreads likes and repost counts across keys, then aggregates them for reads instead of sending every update to one hot record.", highTradeoff: "Aggregated counts may be briefly stale; timeline ranking and recommendation quality are not modeled.",
  },
  {
    problemId: "chat-system", title: "Chat System", focus: "reliable one-to-one and group message delivery", table: "messages", columns: ["conversationId", "messageId", "senderId", "createdAt"], index: "conversationId", readPath: "/conversations/:id/messages", writePath: "/conversations/:id/messages", middle: "queue", middleFocus: "store and forward messages for offline recipients", middleWhy: "The broker decouples accepting a message from delivery to connected devices and gives offline delivery a durable handoff point.", middleTradeoff: "At-least-once delivery requires message IDs and consumer deduplication; strict per-conversation ordering is a partitioning policy not verified by this model.", highComponent: "websocket-server", highFocus: "maintain persistent connections for online delivery", highWhy: "A dedicated connection tier holds long-lived client sessions so message delivery does not depend on repeated polling requests.", highTradeoff: "Connection routing, presence TTLs, read receipts, and end-to-end encryption need real protocol and state-machine design beyond this simulator.",
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
    problemId: "payment-system", title: "Payment System", focus: "creating a payment and recording its ledger state", table: "payments", columns: ["paymentId", "idempotencyKey", "amount", "currency", "status"], index: "idempotencyKey", readPath: "/payments/:id", writePath: "/payments", middle: "queue", middleFocus: "publish payment events for settlement and reconciliation", middleWhy: "The API can commit a payment state transition and publish follow-up work without making settlement providers part of the synchronous request path.", middleTradeoff: "Financial workflows need idempotency, durable audit trails, and explicit failure recovery; the queue model does not prove atomic database-plus-broker commits.", highComponent: "distributed-lock", highFocus: "discuss coordination around contested balance updates", highWhy: "A lock can serialize a narrowly scoped critical section when multiple operations compete for the same account state.", highTradeoff: "Locks can reduce throughput and introduce lease/fencing hazards; prefer transactional ledger constraints where they solve the invariant.",
  },
  {
    problemId: "ticket-booking", title: "Ticket Booking", focus: "searching events and reserving a limited seat", table: "reservations", columns: ["reservationId", "eventId", "seatId", "userId", "status"], index: "eventId", readPath: "/events/:id/seats", writePath: "/reservations", middle: "cache", middleFocus: "cache read-heavy event and seat-map data", middleWhy: "Many users inspect the same event before reserving. Caching read-only event metadata reduces repeated database reads while the reservation write remains authoritative.", middleTradeoff: "Never treat cached availability as a final seat allocation; a transaction or conditional write must decide the winner.", highComponent: "distributed-lock", highFocus: "reason about short-lived seat holds", highWhy: "A lease-based hold can temporarily prevent two users from paying for the same seat while the booking flow completes.", highTradeoff: "Expired locks, payment delays, and fencing tokens make correctness subtle; this component alone does not guarantee exactly-once booking.",
  },
  {
    problemId: "collaborative-editor", title: "Collaborative Editor", focus: "saving documents and distributing edits to collaborators", table: "document_snapshots", columns: ["documentId", "version", "contentRef", "updatedAt"], index: "documentId", readPath: "/documents/:id", writePath: "/documents/:id/snapshots", middle: "queue", middleFocus: "fan out edit events to connected collaborators", middleWhy: "A broker decouples accepted edits from downstream fan-out and snapshot work, allowing live collaboration and persistence consumers to scale independently.", middleTradeoff: "Operational Transformation and CRDT conflict resolution are not implemented by a queue; ordering and merge correctness must be specified separately.", highComponent: "websocket-server", highFocus: "keep collaborators connected for live updates", highWhy: "Persistent connections reduce polling overhead and let the service push document updates to active editors.", highTradeoff: "Per-document ordering, cursor presence, offline merge, and authorization on every event are not modeled here.",
  },
  {
    problemId: "file-storage", title: "File Storage", focus: "uploading file bytes and looking up file metadata", table: "files", columns: ["fileId", "ownerId", "objectKey", "version", "createdAt"], index: "ownerId", readPath: "/files/:id", writePath: "/files", extraCore: ["object-storage"], middle: "queue", middleFocus: "process file-change events asynchronously", middleWhy: "Virus scanning, thumbnails, and sync notifications can run after an upload is accepted, without holding the client request open for every downstream task.", middleTradeoff: "Chunk boundaries, content-addressed deduplication, conflict resolution, and resumable-upload semantics need separate protocols.", highComponent: "cdn", highFocus: "deliver frequently accessed files closer to readers", highWhy: "A CDN can cache public or safely shareable file content and reduce repeated origin reads.", highTradeoff: "Private files need authorization-aware signed delivery and careful cache keys; global invalidation and data residency are not modeled.", highEdge: ["cdn", "object-storage"], highExtra: ["object-storage"],
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
    problemId: "ecommerce", title: "E-Commerce", focus: "browsing a product catalog and placing orders", table: "orders", columns: ["orderId", "customerId", "status", "total", "createdAt"], index: "customerId", readPath: "/products", writePath: "/orders", middle: "cache", middleFocus: "cache popular product catalog reads", middleWhy: "Product detail and category pages are read-heavy and often repeated; caching reduces catalog database load while writes update inventory and orders through authoritative paths.", middleTradeoff: "Price and stock must not be trusted from stale cache at checkout; invalidation and conditional inventory updates need explicit design.", highComponent: "message-queue", highFocus: "publish order events for fulfillment and projections", highWhy: "An order event lets fulfillment, email, and analytics react independently after order acceptance.", highTradeoff: "The message queue does not provide atomic event sourcing or exactly-once side effects; consumers need idempotency and reconciliation.",
  },
  {
    problemId: "team-messaging", title: "Team Messaging", focus: "storing channel messages and notifying active members", table: "channel_messages", columns: ["workspaceId", "channelId", "messageId", "authorId", "createdAt"], index: "channelId", readPath: "/channels/:id/messages", writePath: "/channels/:id/messages", middle: "queue", middleFocus: "index and fan out messages asynchronously", middleWhy: "Search indexing, notifications, and channel fan-out are independent consumers; a broker prevents those tasks from slowing the message write path.", middleTradeoff: "Workspace partitioning, search relevance, and ordered thread materialization need additional partition and consistency policies.", highComponent: "websocket-server", highFocus: "push new channel messages to active clients", highWhy: "Persistent connections deliver updates without each client polling every channel for new messages.", highTradeoff: "Connection routing and workspace-level noisy-neighbor isolation are not covered by the graph or queue contracts.",
  },
  {
    problemId: "metrics-monitoring", title: "Metrics / Monitoring", focus: "ingesting measurements and querying recent service health", table: "metric_samples", columns: ["metricName", "labels", "value", "timestamp"], index: "timestamp", database: "timeseries-db", readPath: "/metrics/query", writePath: "/metrics/ingest", middle: "queue", middleFocus: "buffer telemetry ingestion before aggregation", middleWhy: "A broker absorbs bursts from many producers and lets aggregation workers batch and process samples independently of ingestion APIs.", middleTradeoff: "Queue buffering does not define retention, cardinality limits, or backpressure; those are central to time-series cost and reliability.", highComponent: "monitoring", highFocus: "observe ingestion lag and service health", highWhy: "The monitoring tier tracks queue lag, rejected samples, and service saturation so operators can detect a pipeline that is falling behind.", highTradeoff: "Monitoring the monitoring system requires independent alert paths; downsampling and anomaly detection are not verified here.",
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
    problemId: "search-engine", title: "Search Engine", focus: "accepting documents and serving search queries", table: "documents", columns: ["documentId", "url", "title", "contentRef", "indexedAt"], index: "url", readPath: "/search", writePath: "/documents", extraCore: ["object-storage"], middle: "queue", middleFocus: "index document changes asynchronously", middleWhy: "Document ingestion and query serving have different workloads. A queue lets indexers consume changes in batches without blocking crawlers or content writers.", middleTradeoff: "The index can lag behind source data; shard placement, BM25 tuning, PageRank, and spell correction are not validated by the graph.", highComponent: "search", highFocus: "make the query index an explicit serving tier", highWhy: "A dedicated search service can serve inverted-index queries without scanning the canonical document store.", highTradeoff: "Index freshness, shard fan-out, ranking quality, and query scatter-gather costs require workload benchmarks.",
  },
  {
    problemId: "location-service", title: "Location-Based Service", focus: "finding nearby businesses and returning useful details", table: "businesses", columns: ["businessId", "name", "category", "location", "rating"], index: "category", readPath: "/businesses/nearby", writePath: "/businesses", middle: "cache", middleFocus: "cache popular nearby-search results", middleWhy: "Frequently searched neighborhoods and categories can reuse result pages, reducing repeated database and geo-query work.", middleTradeoff: "Location changes and ratings can make cached results stale; cache keys must include the query region and filters.", highComponent: "geospatial-index", highFocus: "support proximity and radius filtering", highWhy: "A geospatial index narrows candidate businesses by location before category and relevance filters are applied.", highTradeoff: "QuadTree/geohash partitioning, ranking weights, and location privacy are not verified by this model.",
  },
  {
    problemId: "tiktok", title: "TikTok / Short Video", focus: "publishing short videos and serving a personalized feed", table: "videos", columns: ["videoId", "creatorId", "objectKey", "status", "createdAt"], index: "creatorId", readPath: "/feed", writePath: "/videos", extraCore: ["object-storage"], middle: "queue", middleFocus: "transcode and moderate uploads asynchronously", middleWhy: "Transcoding and moderation are resource-heavy tasks that can run after the upload is accepted, with workers scaled independently.", middleTradeoff: "Moderation false positives, encoding profiles, and recommendation quality require separate models and are not inferred from queue throughput.", highComponent: "stream-processor", highFocus: "aggregate watch and engagement events", highWhy: "A stream processor can maintain rolling popularity signals from view, completion, and interaction events for downstream feed generation.", highTradeoff: "Two-tower recommendation, user embeddings, content safety policy, and ranking freshness are conceptual rather than simulated.",
  },
  {
    problemId: "message-queue-design", title: "Message Queue Design", focus: "accepting records and delivering them to consumer groups", table: "consumer_offsets", columns: ["groupId", "topic", "partitionId", "offset", "updatedAt"], index: "groupId", database: "nosql-db", readPath: "/consumer-groups/:id/offsets", writePath: "/topics/:topic/messages", middle: "queue", middleFocus: "define topic subscriptions and competing consumers", middleWhy: "Topics decouple producers from consumers, and competing consumers allow work to be distributed across a consumer group.", middleTradeoff: "Partition assignment, offset commits, replay, and ordering guarantees are broker semantics; a graph-level queue contract cannot prove them.", highComponent: "coordination-service", highFocus: "coordinate broker membership and leadership", highWhy: "A coordination service can track membership and leadership for a distributed broker cluster.", highTradeoff: "Consensus and rebalancing behavior are conceptual; replication count alone does not establish durable or exactly-once delivery.",
  },
  {
    problemId: "digital-wallet", title: "Digital Wallet", focus: "checking balances and transferring value", table: "ledger_entries", columns: ["entryId", "walletId", "transactionId", "amount", "currency", "createdAt"], index: "transactionId", readPath: "/wallets/:id/balance", writePath: "/transfers", middle: "queue", middleFocus: "publish transfer events for settlement and reconciliation", middleWhy: "Asynchronous downstream settlement and notifications can proceed after a durable transfer state transition rather than extending the user-facing request.", middleTradeoff: "Ledger invariants require atomic debit/credit handling and idempotency. A queue does not create an atomic transaction across services.", highComponent: "distributed-lock", highFocus: "analyze contention on shared wallet state", highWhy: "A narrowly scoped lock can serialize conflicting updates when the transaction design cannot rely solely on conditional database writes.", highTradeoff: "Lock failure and lease safety can threaten financial correctness; prefer an immutable double-entry ledger and transactional constraints where possible.",
  },
  {
    problemId: "code-editor", title: "Online Code Editor", focus: "saving project files and running code safely", table: "projects", columns: ["projectId", "ownerId", "objectKey", "language", "updatedAt"], index: "ownerId", readPath: "/projects/:id", writePath: "/projects/:id/files", extraCore: ["object-storage"], middle: "queue", middleFocus: "dispatch code execution to isolated workers", middleWhy: "Compilation and execution are variable, resource-intensive jobs; queuing them keeps editor APIs responsive and gives workers a separate scaling boundary.", middleTradeoff: "A queue does not sandbox untrusted code. Container isolation, CPU/memory limits, network policy, and cleanup must be enforced by an execution platform.", highComponent: "task-scheduler", highFocus: "manage execution lifecycle and timeouts", highWhy: "A scheduler can coordinate delayed cleanup, job timeouts, and retryable background tasks around execution workers.", highTradeoff: "Cold starts, snapshots, language images, and sandbox escape resistance require dedicated runtime engineering and security review.",
  },
  {
    problemId: "cicd-pipeline", title: "CI/CD Pipeline", focus: "accepting build jobs and storing their artifacts", table: "builds", columns: ["buildId", "repository", "commitSha", "status", "createdAt"], index: "repository", readPath: "/builds/:id", writePath: "/builds", extraCore: ["object-storage"], middle: "queue", middleFocus: "dispatch builds to independent workers", middleWhy: "Build duration varies by repository and test suite; a queue buffers submissions and lets runner capacity scale independently from the control-plane API.", middleTradeoff: "Queue dispatch does not model dependency DAG scheduling, cache correctness, or artifact provenance; workers need idempotent job handling.", highComponent: "task-scheduler", highFocus: "coordinate pipeline stages and retries", highWhy: "A scheduler can track job dependencies, retry policies, timeouts, and deployment stages across a multi-step pipeline.", highTradeoff: "Canary analysis, rollback thresholds, dependency resolution, and runner isolation are not simulated by the scheduler node.",
  },
];

function pathEdges(database: string, extraCore: string[] = []) {
  return [
    { sourceComponentId: "load-balancer", targetComponentId: "api-gateway" },
    { sourceComponentId: "api-gateway", targetComponentId: "app-server" },
    { sourceComponentId: "app-server", targetComponentId: database },
    ...extraCore.map((componentId) => ({ sourceComponentId: "app-server", targetComponentId: componentId })),
  ];
}

function makeTrack(spec: TrackSpec): SystemTutorial {
  const database = spec.database ?? "sql-db";
  const extraCore = spec.extraCore ?? [];
  const readTarget = `${spec.table}.${spec.index}`;
  const writeTarget = `${spec.table}.${spec.columns.join(",")}`;
  const lowSteps: TutorialStep[] = [
    {
      id: `${spec.problemId}-low-path`,
      title: "Build the first request path",
      prompt: `Add Load Balancer → API Gateway → App Server → ${database}, then connect any required media or file storage shown in the lesson. This is the starting architecture for ${spec.focus}.`,
      why: `The load balancer and gateway provide a controlled entry path, the app server owns business rules for ${spec.focus}, and ${database} keeps the authoritative records.`,
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
      prompt: `On ${database}, create a ${spec.table} table with ${spec.columns.join(", ")}; add an index on ${spec.index} for the lesson's main lookup.`,
      why: `The schema documents the data required for ${spec.focus}, and the ${spec.index} index makes the expected lookup explicit instead of relying on a full scan.`,
      tradeoff: "Indexes consume storage and add write amplification. Add them for observed query patterns rather than indexing every field.",
      objective: { kind: "database-schema", databaseComponentId: database, tableName: spec.table, columns: spec.columns, indexedColumns: [spec.index] },
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
          prompt: `Add a Message Queue and Stream Processor. Create the topic ${spec.problemId}-events, subscribe the processor in competing-consumer mode, add a publish-event step to POST /events, and connect App Server → Queue → Processor with an asynchronous producer edge. Use it for this lesson's job: ${spec.middleFocus}.`,
          why: spec.middleWhy,
          tradeoff: spec.middleTradeoff,
          hint: "Configure the topic and consumer subscription on the queue, the publish operation on App Server, and mark the App Server → Queue edge asynchronous.",
          objective: { kind: "queue-contract", serviceComponentId: "app-server", queueComponentId: "message-queue", consumerComponentId: "stream-processor", topicName: `${spec.problemId}-events`, producerEndpoint: { method: "POST", path: "/events" }, deliveryMode: "competing", requireAsync: true },
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
  mediumSteps.push({
    id: `${spec.problemId}-medium-review`,
    title: "Check the medium-load assumptions",
    prompt: "Increase App Server replicas to at least two, run the 1,000 requests/sec scenario, and compare the added cache or worker tier with the original single-service design.",
    why: "A moderate-load checkpoint encourages you to compare the new architecture against its low-load baseline and identify which tier now has independent capacity.",
    tradeoff: "The simulator is a deterministic aggregate estimator; it does not prove cache coherence, queue time-series behavior, or production latency percentiles.",
    objective: { kind: "replicas", components: [{ componentId: "app-server", minimum: 2 }] },
  });

  const highEdge = spec.highEdge ?? ["app-server", spec.highComponent];
  const highSteps: TutorialStep[] = [
    {
      id: `${spec.problemId}-high-extension`,
      title: "Add a system-specific scale boundary",
      prompt: `Add ${spec.highComponent}${(spec.highExtra ?? []).includes(spec.highComponent) ? "" : ` and any required supporting component${spec.highExtra?.length ? "s" : ""}`} to the graph. Connect ${highEdge[0]} → ${highEdge[1]} and use it to ${spec.highFocus}.`,
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
      prompt: "Run the 5,000 requests/sec scenario on the current design. Compare offered and accepted traffic, bottlenecks, and queue backlog if present; state one assumption that must be validated before production.",
      why: "The final checkpoint connects architecture choices to the simulator's observable aggregate outcome and asks you to distinguish modeled facts from operational assumptions.",
      tradeoff: "This is not a production SLO or proof of correctness. Domain-specific behavior such as ranking, geospatial accuracy, transactions, encryption, or adaptive delivery may remain conceptual.",
      objective: { kind: "simulation-checkpoint", requestsPerSec: 5_000 },
    },
  ];

  const levels: [TutorialLevel, TutorialLevel, TutorialLevel] = [
    { id: "low", title: "Build the essential system", trafficLabel: "Low traffic · 100 requests/sec", requestsPerSec: 100, goal: `Build the smallest durable architecture for ${spec.focus}.`, steps: lowSteps },
    { id: "medium", title: "Separate hot paths and background work", trafficLabel: "Medium traffic · 1,000 requests/sec", requestsPerSec: 1_000, goal: `Reduce repeated work or decouple long-running work for ${spec.focus}.`, steps: mediumSteps },
    { id: "high", title: "Scale and inspect the design", trafficLabel: "High traffic · 5,000 requests/sec", requestsPerSec: 5_000, goal: `Add a system-specific scaling boundary for ${spec.focus} and examine its trade-offs.`, steps: highSteps },
  ];
  return {
    problemId: spec.problemId,
    learningObjectives: [
      `Model the main request and data path for ${spec.focus}.`,
      `Explain the cost and consistency trade-offs of ${spec.middle === "cache" ? "caching" : "asynchronous processing"} as traffic grows.`,
      `Distinguish simulator-verified topology and capacity from domain guarantees that need separate design.`,
    ],
    levels,
  };
}

export const ADDITIONAL_SYSTEM_TUTORIALS = specs.map(makeTrack);
