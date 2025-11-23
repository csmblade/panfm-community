/**
 * ThroughputDataService - Enterprise-grade data management for PANfm
 *
 * Features:
 * - Singleton instance shared across all pages
 * - Observable pattern for real-time updates
 * - Smart caching with TTL and device-based invalidation
 * - Automatic deduplication of API calls
 * - Background refresh scheduling
 * - Historical data aggregation
 *
 * @version 2.1.0
 * @author PANfm Development Team
 */
class ThroughputDataService {
    constructor() {
        // Singleton enforcement
        if (ThroughputDataService.instance) {
            return ThroughputDataService.instance;
        }
        ThroughputDataService.instance = this;

        // ============================================================
        // STATE MANAGEMENT
        // ============================================================

        /** @type {Object} Latest real-time snapshot */
        this.latestSnapshot = null;

        /** @type {Map<string, CachedData>} Historical data cache by range */
        this.historicalCache = new Map();

        /** @type {string} Currently selected device ID */
        this.currentDeviceId = null;

        /** @type {Map<string, Set<Function>>} Event subscribers */
        this.subscribers = new Map([
            ['snapshot:update', new Set()],
            ['historical:update', new Set()],
            ['device:change', new Set()],
            ['error', new Set()],
            ['waiting', new Set()]
        ]);

        /** @type {Map<string, Promise>} In-flight requests (deduplication) */
        this.pendingRequests = new Map();

        /** @type {number} Auto-refresh interval ID */
        this.refreshIntervalId = null;

        /** @type {number} Refresh interval in milliseconds */
        this.refreshInterval = 60000; // 60 seconds (configurable)

        /** @type {number} Cache TTL in milliseconds */
        this.cacheTTL = 5 * 60 * 1000; // 5 minutes

        /** @type {boolean} Service initialization state */
        this.initialized = false;

        // ============================================================
        // CONFIGURATION
        // ============================================================

        this.config = {
            // API endpoints
            endpoints: {
                snapshot: '/api/throughput',
                historical: '/api/throughput/history',
                stats: '/api/throughput/history/stats'
            },

            // Cache settings
            cache: {
                enabled: true,
                ttl: 5 * 60 * 1000, // 5 minutes
                maxSize: 50 // Max cached ranges
            },

            // Refresh settings
            refresh: {
                enabled: true,
                interval: 60000, // 60 seconds
                retryDelay: 5000 // 5 seconds on error
            },

            // Request deduplication
            deduplication: {
                enabled: true,
                window: 1000 // 1 second dedup window
            }
        };

        console.log('[ThroughputDataService] Service initialized (singleton v2.1.0)');
    }

    // ============================================================
    // INITIALIZATION
    // ============================================================

    /**
     * Initialize the service with device ID and settings
     * @param {string} deviceId - Device ID to monitor
     * @param {Object} settings - Application settings
     */
    async initialize(deviceId, settings = {}) {
        if (this.initialized && this.currentDeviceId === deviceId) {
            console.log('[ThroughputDataService] Already initialized for device:', deviceId);
            return;
        }

        console.log('[ThroughputDataService] Initializing for device:', deviceId);

        // Clear old data if device changed
        if (this.currentDeviceId !== deviceId) {
            this.invalidateAllCache();
            this.emit('device:change', { oldDeviceId: this.currentDeviceId, newDeviceId: deviceId });
        }

        this.currentDeviceId = deviceId;

        // Apply settings
        if (settings.refresh_interval) {
            this.refreshInterval = settings.refresh_interval * 1000;
            this.config.refresh.interval = this.refreshInterval;
        }

        // Start auto-refresh
        if (this.config.refresh.enabled) {
            this.startAutoRefresh();
        }

        // Load initial data
        await this.fetchSnapshot();

        this.initialized = true;
        console.log('[ThroughputDataService] Initialization complete');
    }

    // ============================================================
    // PUBLIC API - REAL-TIME SNAPSHOT
    // ============================================================

    /**
     * Get latest real-time throughput snapshot
     * @param {boolean} forceRefresh - Force API call even if cached
     * @returns {Promise<Object>} Latest throughput data
     */
    async getSnapshot(forceRefresh = false) {
        // Return cached snapshot if fresh
        if (!forceRefresh && this.latestSnapshot && this._isSnapshotFresh()) {
            console.log('[ThroughputDataService] Returning cached snapshot');
            return this.latestSnapshot.data;
        }

        // Fetch fresh snapshot
        return await this.fetchSnapshot();
    }

    /**
     * Fetch fresh snapshot from API
     * @returns {Promise<Object>} Latest throughput data
     */
    async fetchSnapshot() {
        const cacheKey = 'snapshot';

        // Request deduplication
        if (this.config.deduplication.enabled && this.pendingRequests.has(cacheKey)) {
            console.log('[ThroughputDataService] Deduplicating snapshot request');
            return await this.pendingRequests.get(cacheKey);
        }

        const requestPromise = this._executeSnapshotRequest();
        this.pendingRequests.set(cacheKey, requestPromise);

        try {
            const data = await requestPromise;
            this.pendingRequests.delete(cacheKey);
            return data;
        } catch (error) {
            this.pendingRequests.delete(cacheKey);
            throw error;
        }
    }

    /**
     * Internal: Execute snapshot API request
     * @private
     */
    async _executeSnapshotRequest() {
        try {
            const response = await window.apiClient.get('/api/throughput', {
                params: { device_id: this.currentDeviceId }
            });

            if (!response.ok) {
                throw new Error(`API error: ${response.data?.message || 'Unknown error'}`);
            }

            const data = response.data;

            // Handle waiting status
            if (data.status === 'waiting') {
                console.log('[ThroughputDataService] Waiting for first collection:', data.message);
                this.emit('waiting', data);
                return data;
            }

            // Handle no_data status (v2.1.1 - collector has no recent data)
            if (data.status === 'no_data') {
                console.log('[ThroughputDataService] No recent data from collector:', data.message);
                this.emit('no_data', data);
                return data;
            }

            // Update cache
            this.latestSnapshot = {
                data: data,
                timestamp: new Date(),
                deviceId: this.currentDeviceId
            };

            // Notify subscribers
            this.emit('snapshot:update', data);

            console.log('[ThroughputDataService] Snapshot updated:', data.timestamp);
            return data;

        } catch (error) {
            console.error('[ThroughputDataService] Snapshot fetch failed:', error);
            this.emit('error', { type: 'snapshot', error });
            throw error;
        }
    }

    // ============================================================
    // PUBLIC API - HISTORICAL DATA
    // ============================================================

    /**
     * Get historical throughput data for a time range
     * @param {string} range - Time range (5m, 15m, 30m, 1h, 6h, 24h, 7d, 30d)
     * @param {Object} options - Query options
     * @returns {Promise<Array>} Array of throughput samples
     */
    async getHistorical(range, options = {}) {
        const {
            forceRefresh = false,
            resolution = 'auto'
        } = options;

        const cacheKey = `${this.currentDeviceId}:${range}:${resolution}`;

        // Return cached data if fresh and not forcing refresh
        if (!forceRefresh && this.config.cache.enabled) {
            const cached = this.historicalCache.get(cacheKey);
            if (cached && this._isCacheFresh(cached)) {
                console.log(`[ThroughputDataService] Cache HIT for ${range} (${cached.data.samples?.length || 0} samples)`);
                return cached.data.samples || [];
            }
        }

        // Cache miss - fetch fresh data
        console.log(`[ThroughputDataService] Cache MISS for ${range} - fetching from API`);
        return await this.fetchHistorical(range, resolution);
    }

    /**
     * Fetch historical data from API
     * @param {string} range - Time range
     * @param {string} resolution - Data resolution
     * @returns {Promise<Array>} Array of samples
     */
    async fetchHistorical(range, resolution = 'auto') {
        const cacheKey = `${this.currentDeviceId}:${range}:${resolution}`;

        // Request deduplication
        if (this.config.deduplication.enabled && this.pendingRequests.has(cacheKey)) {
            console.log(`[ThroughputDataService] Deduplicating historical request (${range})`);
            return await this.pendingRequests.get(cacheKey);
        }

        const requestPromise = this._executeHistoricalRequest(range, resolution);
        this.pendingRequests.set(cacheKey, requestPromise);

        try {
            const samples = await requestPromise;
            this.pendingRequests.delete(cacheKey);
            return samples;
        } catch (error) {
            this.pendingRequests.delete(cacheKey);
            throw error;
        }
    }

    /**
     * Internal: Execute historical API request
     * @private
     */
    async _executeHistoricalRequest(range, resolution) {
        try {
            const response = await window.apiClient.get('/api/throughput/history', {
                params: {
                    device_id: this.currentDeviceId,
                    range: range,
                    resolution: resolution
                }
            });

            if (!response.ok) {
                throw new Error(`API error: ${response.data?.message || 'Unknown error'}`);
            }

            const data = response.data;

            // Handle waiting status
            if (data.status === 'waiting') {
                console.log('[ThroughputDataService] Waiting for historical data:', data.message);
                this.emit('waiting', data);
                return [];
            }

            // Cache the result
            const cacheKey = `${this.currentDeviceId}:${range}:${resolution}`;
            this.historicalCache.set(cacheKey, {
                data: data,
                timestamp: new Date(),
                range: range,
                resolution: resolution,
                deviceId: this.currentDeviceId
            });

            // Enforce cache size limit
            this._enforceCacheLimit();

            // Notify subscribers
            this.emit('historical:update', { range, samples: data.samples || [] });

            console.log(`[ThroughputDataService] Historical data cached (${range}): ${data.samples?.length || 0} samples`);
            return data.samples || [];

        } catch (error) {
            console.error(`[ThroughputDataService] Historical fetch failed (${range}):`, error);
            this.emit('error', { type: 'historical', range, error });
            throw error;
        }
    }

    // ============================================================
    // SUBSCRIPTION MANAGEMENT (OBSERVABLE PATTERN)
    // ============================================================

    /**
     * Subscribe to data updates
     * @param {string} event - Event name (snapshot:update, historical:update, device:change, error, waiting)
     * @param {Function} callback - Callback function
     * @returns {Function} Unsubscribe function
     */
    subscribe(event, callback) {
        if (!this.subscribers.has(event)) {
            console.warn(`[ThroughputDataService] Unknown event: ${event}`);
            return () => {};
        }

        this.subscribers.get(event).add(callback);
        console.log(`[ThroughputDataService] Subscriber added for: ${event}`);

        // Return unsubscribe function
        return () => {
            this.subscribers.get(event).delete(callback);
            console.log(`[ThroughputDataService] Subscriber removed for: ${event}`);
        };
    }

    /**
     * Emit event to all subscribers
     * @param {string} event - Event name
     * @param {*} data - Event data
     * @private
     */
    emit(event, data) {
        if (!this.subscribers.has(event)) return;

        this.subscribers.get(event).forEach(callback => {
            try {
                callback(data);
            } catch (error) {
                console.error(`[ThroughputDataService] Subscriber error (${event}):`, error);
            }
        });
    }

    // ============================================================
    // AUTO-REFRESH
    // ============================================================

    /**
     * Start automatic refresh of snapshot data
     */
    startAutoRefresh() {
        if (this.refreshIntervalId) {
            console.log('[ThroughputDataService] Auto-refresh already running');
            return;
        }

        console.log(`[ThroughputDataService] Starting auto-refresh (${this.refreshInterval}ms)`);

        this.refreshIntervalId = setInterval(() => {
            this.fetchSnapshot().catch(error => {
                console.error('[ThroughputDataService] Auto-refresh failed:', error);
            });
        }, this.refreshInterval);
    }

    /**
     * Stop automatic refresh
     */
    stopAutoRefresh() {
        if (this.refreshIntervalId) {
            clearInterval(this.refreshIntervalId);
            this.refreshIntervalId = null;
            console.log('[ThroughputDataService] Auto-refresh stopped');
        }
    }

    /**
     * Update refresh interval
     * @param {number} intervalMs - New interval in milliseconds
     */
    setRefreshInterval(intervalMs) {
        this.refreshInterval = intervalMs;
        this.config.refresh.interval = intervalMs;
        console.log(`[ThroughputDataService] Refresh interval updated to ${intervalMs}ms`);

        // Restart auto-refresh with new interval
        if (this.refreshIntervalId) {
            this.stopAutoRefresh();
            this.startAutoRefresh();
        }
    }

    // ============================================================
    // CACHE MANAGEMENT
    // ============================================================

    /**
     * Invalidate all cached data (e.g., when device changes)
     */
    invalidateAllCache() {
        console.log('[ThroughputDataService] Invalidating all cache');
        this.latestSnapshot = null;
        this.historicalCache.clear();
    }

    /**
     * Invalidate historical cache for specific range
     * @param {string} range - Time range to invalidate
     */
    invalidateHistoricalCache(range) {
        const keysToDelete = [];
        for (const [key, cached] of this.historicalCache.entries()) {
            if (cached.range === range) {
                keysToDelete.push(key);
            }
        }
        keysToDelete.forEach(key => this.historicalCache.delete(key));
        console.log(`[ThroughputDataService] Invalidated cache for range: ${range}`);
    }

    /**
     * Check if snapshot is fresh
     * @private
     */
    _isSnapshotFresh() {
        if (!this.latestSnapshot) return false;
        const age = Date.now() - this.latestSnapshot.timestamp.getTime();
        return age < this.cacheTTL;
    }

    /**
     * Check if cached data is fresh
     * @private
     */
    _isCacheFresh(cached) {
        const age = Date.now() - cached.timestamp.getTime();
        return age < this.config.cache.ttl;
    }

    /**
     * Enforce cache size limit (LRU eviction)
     * @private
     */
    _enforceCacheLimit() {
        if (this.historicalCache.size <= this.config.cache.maxSize) return;

        // Sort by timestamp (oldest first)
        const sorted = Array.from(this.historicalCache.entries())
            .sort((a, b) => a[1].timestamp - b[1].timestamp);

        // Remove oldest entries
        const toRemove = sorted.length - this.config.cache.maxSize;
        for (let i = 0; i < toRemove; i++) {
            this.historicalCache.delete(sorted[i][0]);
        }

        console.log(`[ThroughputDataService] Cache evicted ${toRemove} old entries`);
    }

    // ============================================================
    // UTILITY METHODS
    // ============================================================

    /**
     * Get current device ID
     * @returns {string} Device ID
     */
    getDeviceId() {
        return this.currentDeviceId;
    }

    /**
     * Get cache statistics
     * @returns {Object} Cache stats
     */
    getCacheStats() {
        return {
            snapshotCached: !!this.latestSnapshot,
            historicalCached: this.historicalCache.size,
            cacheLimit: this.config.cache.maxSize,
            snapshotAge: this.latestSnapshot ? Date.now() - this.latestSnapshot.timestamp.getTime() : null,
            cacheKeys: Array.from(this.historicalCache.keys())
        };
    }

    /**
     * Destroy service instance (cleanup)
     */
    destroy() {
        console.log('[ThroughputDataService] Destroying service');
        this.stopAutoRefresh();
        this.invalidateAllCache();
        this.subscribers.forEach(set => set.clear());
        this.initialized = false;
    }
}

// ============================================================
// SINGLETON INSTANCE
// ============================================================

/** Global singleton instance */
window.ThroughputDataService = ThroughputDataService;
window.throughputService = new ThroughputDataService();

console.log('[ThroughputDataService] Service module loaded (v2.1.0)');
