import { HttpInterceptorFn, HttpRequest, HttpResponse } from '@angular/common/http';
import { of, tap, catchError } from 'rxjs';
import { inject } from '@angular/core';
import { AuthService } from '../services/auth.service';

interface CacheEntry {
  response: HttpResponse<any>;
  timestamp: number;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL = 120000; // 2 minutes cache for analytics data (increased for instant cached loads)
const MAX_CACHE_SIZE = 100; // Maximum number of cache entries to prevent memory leaks
const CACHE_CLEANUP_INTERVAL = 60000; // Clean up cache every 60 seconds instead of on every response
let lastCleanupTime = Date.now();

// Cache for stringified request bodies to avoid repeated JSON.stringify calls
const bodyCache = new Map<string, string>();

// Function to clear cache for a specific site or all cache
export function clearCacheForSite(siteId?: string): void {
  if (siteId) {
    // Clear cache entries for specific site
    const keysToDelete: string[] = [];
    cache.forEach((value, key) => {
      if (key.includes(`:${siteId}:`)) {
        keysToDelete.push(key);
      }
    });
    keysToDelete.forEach(key => cache.delete(key));
  } else {
    // Clear all cache
    cache.clear();
    bodyCache.clear();
  }
}

// Optimized cache cleanup - only runs periodically, not on every response
function cleanupCacheIfNeeded(): void {
  const now = Date.now();
  // Only cleanup every 60 seconds to reduce overhead
  if (now - lastCleanupTime < CACHE_CLEANUP_INTERVAL) {
    return;
  }
  lastCleanupTime = now;

  // Clean up expired entries
  const keysToDelete: string[] = [];
  cache.forEach((value, key) => {
    if (now - value.timestamp > CACHE_TTL) {
      keysToDelete.push(key);
    }
  });
  keysToDelete.forEach(key => cache.delete(key));

  // If still too large, remove oldest entries
  if (cache.size >= MAX_CACHE_SIZE) {
    const sortedEntries = Array.from(cache.entries())
      .sort((a, b) => a[1].timestamp - b[1].timestamp);
    const toRemove = sortedEntries.slice(0, Math.floor(MAX_CACHE_SIZE / 2));
    toRemove.forEach(([key]) => cache.delete(key));
  }

  // Clean up body cache (keep only last 50 entries)
  if (bodyCache.size > 50) {
    const bodyKeys = Array.from(bodyCache.keys());
    bodyKeys.slice(0, bodyKeys.length - 50).forEach(key => bodyCache.delete(key));
  }
}

// Optimized cache key generation with body caching
function getCacheKey(req: HttpRequest<any>, siteId: string): string {
  let bodyStr = '';
  if (req.body) {
    // Use cached stringified body if available
    const bodyKey = `${req.method}:${req.url}`;
    bodyStr = bodyCache.get(bodyKey) || JSON.stringify(req.body);
    if (!bodyCache.has(bodyKey)) {
      bodyCache.set(bodyKey, bodyStr);
    }
  }
  return `${req.method}:${req.url}:${siteId}:${bodyStr}`;
}

export const CacheInterceptor: HttpInterceptorFn = (req, next) => {
  // Only cache GET and POST requests to analytics endpoints
  const isAnalyticsRequest = req.url.includes('/api/analytics/');
  const isSitesRequest = req.url.includes('/api/sites');
  
  if (!isAnalyticsRequest && !isSitesRequest) {
    return next(req);
  }

  // OPTIMIZATION: Only inject AuthService once per request, cache siteId lookup
  const authService = inject(AuthService);
  const siteId = authService.getSiteId() || '';

  // OPTIMIZATION: Use cached body stringification
  const cacheKey = getCacheKey(req, siteId);
  const cached = cache.get(cacheKey);

  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return of(cached.response.clone());
  }

  // Periodic cache cleanup (non-blocking)
  cleanupCacheIfNeeded();

  return next(req).pipe(
    tap({
      next: (event) => {
        if (event instanceof HttpResponse) {
          cache.set(cacheKey, {
            response: event.clone(),
            timestamp: Date.now()
          });
        }
      },
      error: (err) => {
        console.error('❌ CacheInterceptor: Error processing request:', {
          type: err.name || 'HTTP Error',
          status: err.status,
          statusText: err.statusText,
          message: err.message,
          error: err.error,
          url: req.url,
          method: req.method,
          timestamp: new Date().toISOString()
        });
      }
    }),
    catchError(err => {
      console.error('❌ CacheInterceptor: Request failed:', {
        type: err.name || 'HTTP Error',
        status: err.status,
        statusText: err.statusText,
        message: err.message,
        error: err.error,
        url: req.url,
        method: req.method,
        timestamp: new Date().toISOString()
      });
      throw err; // Re-throw to let error handlers in components/services handle it
    })
  );
};

