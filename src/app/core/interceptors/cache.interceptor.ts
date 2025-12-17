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
  }
}

export const CacheInterceptor: HttpInterceptorFn = (req, next) => {
  // Only cache GET and POST requests to analytics endpoints
  const isAnalyticsRequest = req.url.includes('/api/analytics/');
  const isSitesRequest = req.url.includes('/api/sites');
  
  if (!isAnalyticsRequest && !isSitesRequest) {
    return next(req);
  }

  // Get current siteId to include in cache key (ensures different sites don't share cache)
  const authService = inject(AuthService);
  const siteId = authService.getSiteId() || '';

  // Create cache key from URL, body, and siteId
  const cacheKey = `${req.method}:${req.url}:${siteId}:${JSON.stringify(req.body || {})}`;
  const cached = cache.get(cacheKey);

  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return of(cached.response.clone());
  }

  return next(req).pipe(
    tap({
      next: (event) => {
        if (event instanceof HttpResponse) {
          // Clean up old entries if cache is too large
          if (cache.size >= MAX_CACHE_SIZE) {
            const now = Date.now();
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
          }
          
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

