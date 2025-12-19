import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, forkJoin, tap, catchError, of, shareReplay, timeout, Subject, retry, delay } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthService } from './auth.service';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private base = environment.apiUrl;
  private readonly TWELVE_HOURS_MS = 2 * 60 * 60 * 1000; // Reduced to 2 hours for ultra-fast loading (1-2 seconds target)
  private readonly SIX_HOURS_MS = 1 * 60 * 60 * 1000; // Reduced to 1 hour for entry-exit (faster queries)
  private readonly REQUEST_TIMEOUT = 15000; // 15 seconds timeout (balanced: allows backend processing time while still detecting failures)
  // Cache sites API response to avoid repeated calls
  private sitesCache$?: ReturnType<typeof this.createSitesCache>;
  // Request deduplication: share observables to prevent duplicate requests
  private footfallCache$?: ReturnType<typeof this.createFootfallCache>;
  private dwellCache$?: ReturnType<typeof this.createDwellCache>;
  private occupancyCache$?: ReturnType<typeof this.createOccupancyCache>;
  private demographicsCache$?: ReturnType<typeof this.createDemographicsCache>;
  // Entry-exit cache: keyed by pageNumber and pageSize for proper pagination caching
  private entryExitCache = new Map<string, ReturnType<typeof this.createEntryExitCache>>();
  
  // OPTIMIZATION: Cache date calculations for current day to avoid repeated Date object creation
  private cachedDayPayload: { day: number; fromUtc: number; toUtc: number } | null = null;
  private readonly DAY_MS = 24 * 60 * 60 * 1000;
  
  // OPTIMIZATION: Subject for canceling pending requests when site changes
  private cancelPendingRequests$ = new Subject<void>();

  constructor(
    private http: HttpClient,
    private auth: AuthService
  ) {}

  private createSitesCache() {
    return this.http.get<any[]>(`${this.base}/api/sites`).pipe(
      tap(sites => {
        // Response logged only for debugging - removed to reduce console noise
        // If no siteId is set, use the first site from the list
        // Note: SiteService notification is handled by LayoutComponent
        // to avoid circular dependencies
        if (!this.auth.getSiteId() && sites && sites.length > 0 && sites[0]?.siteId) {
          this.auth.setSiteId(sites[0].siteId);
        }
      }),
      catchError(error => {
        const errorInfo = {
          type: error.name || 'HTTP Error',
          status: error.status,
          statusText: error.statusText,
          message: error.message,
          error: error.error,
          url: `${this.base}/api/sites`,
          timestamp: new Date().toISOString()
        };
        console.error('❌ API ERROR: /api/sites', errorInfo);
        return of([]);
      }),
      shareReplay(1)
    );
  }

  getSites() {
    if (!this.sitesCache$) {
      this.sitesCache$ = this.createSitesCache();
    }
    return this.sitesCache$;
  }

  private payload(extra: any = {}) {
    const now = Date.now();
    const siteId = this.auth.getSiteId();
    
    // OPTIMIZATION: Cache date calculations for the current day
    // Only recalculate if we've moved to a new day
    const currentDay = Math.floor(now / this.DAY_MS);
    
    if (!this.cachedDayPayload || this.cachedDayPayload.day !== currentDay) {
      // For Overall Occupancy: use 8:00 to 18:00 (10 hours) as per prototype
      // Use local time (user expects 8:00-18:00 in their timezone)
      const today = new Date();
      today.setHours(8, 0, 0, 0);
      const fromUtc = today.getTime(); // This is already in UTC milliseconds
      const endOfDay = new Date();
      endOfDay.setHours(18, 0, 0, 0);
      const toUtc = Math.min(now, endOfDay.getTime()); // End at 18:00 local time or current time, whichever is earlier
      
      this.cachedDayPayload = {
        day: currentDay,
        fromUtc,
        toUtc
      };
    }
    
    // Use cached values but update toUtc with current time if it's today
    const fromUtc = this.cachedDayPayload.fromUtc;
    const endOfDay = new Date();
    endOfDay.setHours(18, 0, 0, 0);
    const toUtc = Math.min(now, endOfDay.getTime());
    
    const payload = {
      siteId: siteId || '',
      fromUtc,
      toUtc,
      ...extra
    };
    return payload;
  }

  private entryExitPayload(pageNumber: number, pageSize: number, fromUtc?: number, toUtc?: number) {
    const siteId = this.auth.getSiteId();
    const now = Date.now();
    
    // If dates provided, use them; otherwise use default (last 30 minutes)
    const THIRTY_MINUTES_MS = 30 * 60 * 1000;
    const finalFromUtc = fromUtc !== undefined ? fromUtc : (now - THIRTY_MINUTES_MS);
    const finalToUtc = toUtc !== undefined ? toUtc : now;
    
    return {
      siteId: siteId || '',
      fromUtc: finalFromUtc,
      toUtc: finalToUtc,
      pageNumber,
      pageSize
    };
  }

  private createFootfallCache() {
    const payload = this.payload();
    return this.http.post<any>(`${this.base}/api/analytics/footfall`, payload).pipe(
      timeout(this.REQUEST_TIMEOUT),
      // OPTIMIZATION: Cancel request if site changes or cache is cleared
      // takeUntil(this.cancelPendingRequests$), // Uncomment if needed for aggressive cancellation
      tap(res => {
        if (res?.siteId) {
          this.auth.setSiteId(res.siteId);
        }
      }),
      catchError(err => {
        // Log ALL errors including timeouts for debugging
        const errorInfo = {
          type: err.name || 'HTTP Error',
          status: err.status,
          statusText: err.statusText,
          message: err.message,
          error: err.error,
          url: `${this.base}/api/analytics/footfall`,
          timestamp: new Date().toISOString()
        };
        if (err.name === 'TimeoutError') {
          console.error('⏱️ Footfall request timeout:', errorInfo);
        } else {
          console.error('❌ Footfall request failed:', errorInfo);
        }
        return of(null);
      }),
      shareReplay(1)
    );
  }

  private createDwellCache() {
    const payload = this.payload();
    return this.http.post<any>(`${this.base}/api/analytics/dwell`, payload).pipe(
      timeout(this.REQUEST_TIMEOUT),
      tap(res => {
        if (res?.siteId) {
          this.auth.setSiteId(res.siteId);
        }
      }),
      catchError(err => {
        // Log ALL errors including timeouts for debugging
        const errorInfo = {
          type: err.name || 'HTTP Error',
          status: err.status,
          statusText: err.statusText,
          message: err.message,
          error: err.error,
          url: `${this.base}/api/analytics/dwell`,
          timestamp: new Date().toISOString()
        };
        if (err.name === 'TimeoutError') {
          console.error('⏱️ Dwell request timeout:', errorInfo);
        } else {
          console.error('❌ Dwell request failed:', errorInfo);
        }
        return of(null);
      }),
      shareReplay(1)
    );
  }

  private createOccupancyCache() {
    const payload = this.payload();
    return this.http.post<any>(`${this.base}/api/analytics/occupancy`, payload).pipe(
      timeout(this.REQUEST_TIMEOUT),
      catchError(err => {
        // Log ALL errors including timeouts and 404s for debugging
        const errorInfo = {
          type: err.name || 'HTTP Error',
          status: err.status,
          statusText: err.statusText,
          message: err.message,
          error: err.error,
          url: `${this.base}/api/analytics/occupancy`,
          timestamp: new Date().toISOString()
        };
        if (err.status === 404) {
          console.warn('⚠️ Occupancy data not found (404):', errorInfo);
        } else if (err.name === 'TimeoutError') {
          console.error('⏱️ Occupancy request timeout:', errorInfo);
        } else {
          console.error('❌ Occupancy request failed:', errorInfo);
        }
        return of(null);
      }),
      shareReplay(1)
    );
  }

  private createDemographicsCache() {
    // Use 8:00 to 18:00 range for all charts
    const payload = this.payload();
    return this.http.post<any>(`${this.base}/api/analytics/demographics`, payload).pipe(
      timeout(this.REQUEST_TIMEOUT),
      catchError(err => {
        // Log ALL errors including timeouts and 404s for debugging
        const errorInfo = {
          type: err.name || 'HTTP Error',
          status: err.status,
          statusText: err.statusText,
          message: err.message,
          error: err.error,
          url: `${this.base}/api/analytics/demographics`,
          timestamp: new Date().toISOString()
        };
        if (err.status === 404) {
          console.warn('⚠️ Demographics data not found (404):', errorInfo);
        } else if (err.name === 'TimeoutError') {
          console.error('⏱️ Demographics request timeout:', errorInfo);
        } else {
          console.error('❌ Demographics request failed:', errorInfo);
        }
        return of(null);
      }),
      shareReplay(1)
    );
  }

  getFootfall(fromUtc?: number, toUtc?: number) {
    // If dates provided, create new request (bypass cache)
    if (fromUtc !== undefined && toUtc !== undefined) {
      const payload = {
        siteId: this.auth.getSiteId() || '',
        fromUtc,
        toUtc,
      };
      return this.http.post<any>(`${this.base}/api/analytics/footfall`, payload).pipe(
        timeout(this.REQUEST_TIMEOUT),
        catchError(err => {
          // Log ALL errors including timeouts for debugging
          const errorInfo = {
            type: err.name || 'HTTP Error',
            status: err.status,
            statusText: err.statusText,
            message: err.message,
            error: err.error,
            url: `${this.base}/api/analytics/footfall`,
            timestamp: new Date().toISOString()
          };
          if (err.name === 'TimeoutError') {
            console.error('⏱️ Footfall request timeout:', errorInfo);
          } else {
            console.error('❌ Footfall request failed:', errorInfo);
          }
          return of(null);
        })
      );
    }
    // Use cached version for default (today)
    if (!this.footfallCache$) {
      this.footfallCache$ = this.createFootfallCache();
    }
    return this.footfallCache$;
  }

  getDwell(fromUtc?: number, toUtc?: number) {
    // If dates provided, create new request (bypass cache)
    if (fromUtc !== undefined && toUtc !== undefined) {
      const payload = {
        siteId: this.auth.getSiteId() || '',
        fromUtc,
        toUtc,
      };
      return this.http.post<any>(`${this.base}/api/analytics/dwell`, payload).pipe(
        timeout(this.REQUEST_TIMEOUT),
        catchError(err => {
          // Log ALL errors including timeouts for debugging
          const errorInfo = {
            type: err.name || 'HTTP Error',
            status: err.status,
            statusText: err.statusText,
            message: err.message,
            error: err.error,
            url: `${this.base}/api/analytics/dwell`,
            timestamp: new Date().toISOString()
          };
          if (err.name === 'TimeoutError') {
            console.error('⏱️ Dwell request timeout:', errorInfo);
          } else {
            console.error('❌ Dwell request failed:', errorInfo);
          }
          return of(null);
        })
      );
    }
    // Use cached version for default (today)
    if (!this.dwellCache$) {
      this.dwellCache$ = this.createDwellCache();
    }
    return this.dwellCache$;
  }

  private createEntryExitCache(pageNumber: number, pageSize: number, fromUtc?: number, toUtc?: number) {
    const payload = this.entryExitPayload(pageNumber, pageSize, fromUtc, toUtc);
    return this.http.post<any>(
      `${this.base}/api/analytics/entry-exit`,
      payload
    ).pipe(
      timeout(this.REQUEST_TIMEOUT),
      catchError(err => {
        // Log ALL errors including timeouts for debugging
        const errorInfo = {
          type: err.name || 'HTTP Error',
          status: err.status,
          statusText: err.statusText,
          message: err.message,
          error: err.error,
          url: `${this.base}/api/analytics/entry-exit`,
          pageNumber,
          pageSize,
          payload,
          duration: '22+ seconds (backend issue)',
          timestamp: new Date().toISOString()
        };
        if (err.name === 'TimeoutError') {
          console.error('⏱️ Entry-exit request timeout after 15s:', errorInfo);
          console.warn('⚠️ Backend is taking 22+ seconds to respond. This is a backend performance issue.');
        } else {
          console.error('❌ Entry-exit request failed:', errorInfo);
        }
        return of({ records: [], data: [], totalRecords: 0, total: 0 });
      })
      // Removed shareReplay - entry-exit data is time-sensitive and should not be cached
    );
  }

  getEntryExit(pageNumber = 1, pageSize = 50, fromUtc?: number, toUtc?: number) {
    // Entry-exit data is time-sensitive, so we can't cache by page number alone
    // Each request gets fresh data to ensure accuracy
    // Clear any existing cache for this page to ensure fresh data
    const cacheKey = `${pageNumber}-${pageSize}-${fromUtc || 'default'}-${toUtc || 'default'}`;
    if (this.entryExitCache.has(cacheKey)) {
      this.entryExitCache.delete(cacheKey);
    }
    
    // Create new request (bypass cache for time-sensitive data)
    return this.createEntryExitCache(pageNumber, pageSize, fromUtc, toUtc);
  }

  getOccupancy(fromUtc?: number, toUtc?: number) {
    // If dates provided, create new request (bypass cache)
    if (fromUtc !== undefined && toUtc !== undefined) {
      const payload = {
        siteId: this.auth.getSiteId() || '',
        fromUtc,
        toUtc,
      };
      return this.http.post<any>(`${this.base}/api/analytics/occupancy`, payload).pipe(
        timeout(this.REQUEST_TIMEOUT),
        catchError(err => {
          // Log ALL errors including timeouts and 404s for debugging
          const errorInfo = {
            type: err.name || 'HTTP Error',
            status: err.status,
            statusText: err.statusText,
            message: err.message,
            error: err.error,
            url: `${this.base}/api/analytics/occupancy`,
            timestamp: new Date().toISOString()
          };
          if (err.status === 404) {
            console.warn('⚠️ Occupancy data not found (404):', errorInfo);
          } else if (err.name === 'TimeoutError') {
            console.error('⏱️ Occupancy request timeout:', errorInfo);
          } else {
            console.error('❌ Occupancy request failed:', errorInfo);
          }
          return of(null);
        })
      );
    }
    // Use cached version for default (today)
    if (!this.occupancyCache$) {
      this.occupancyCache$ = this.createOccupancyCache();
    }
    return this.occupancyCache$;
  }

  getDemographics(fromUtc?: number, toUtc?: number) {
    // If dates provided, create new request (bypass cache)
    if (fromUtc !== undefined && toUtc !== undefined) {
      const payload = {
        siteId: this.auth.getSiteId() || '',
        fromUtc,
        toUtc,
      };
      return this.http.post<any>(`${this.base}/api/analytics/demographics`, payload).pipe(
        timeout(this.REQUEST_TIMEOUT),
        catchError(err => {
          // Log ALL errors including timeouts and 404s for debugging
          const errorInfo = {
            type: err.name || 'HTTP Error',
            status: err.status,
            statusText: err.statusText,
            message: err.message,
            error: err.error,
            url: `${this.base}/api/analytics/demographics`,
            timestamp: new Date().toISOString()
          };
          if (err.status === 404) {
            console.warn('⚠️ Demographics data not found (404):', errorInfo);
          } else if (err.name === 'TimeoutError') {
            console.error('⏱️ Demographics request timeout:', errorInfo);
          } else {
            console.error('❌ Demographics request failed:', errorInfo);
          }
          return of(null);
        })
      );
    }
    // Use cached version for default (today)
    if (!this.demographicsCache$) {
      this.demographicsCache$ = this.createDemographicsCache();
    }
    return this.demographicsCache$;
  }

  /**
   * OPTIMIZED: Helper to create shared payload for batch requests
   * Eliminates redundant payload creation across batch methods
   */
  private createSharedPayload(fromUtc?: number, toUtc?: number): { siteId: string; fromUtc: number; toUtc: number } {
    const siteId = this.auth.getSiteId() || '';
    if (fromUtc !== undefined && toUtc !== undefined) {
      return { siteId, fromUtc, toUtc };
    }
    const defaultPayload = this.payload();
    const result = { siteId, fromUtc: defaultPayload.fromUtc, toUtc: defaultPayload.toUtc };
    return result;
  }

  /**
   * OPTIMIZED: Reusable error handler for API requests
   * Reduces code duplication across all error handlers
   */
  private handleApiError(err: any, endpoint: string, url: string): Observable<null> {
    const errorInfo = {
      type: err.name || 'HTTP Error',
      status: err.status,
      statusText: err.statusText,
      message: err.message,
      error: err.error,
      url,
      timestamp: new Date().toISOString()
    };
    
    if (err.status === 404) {
      console.warn(`⚠️ ${endpoint} data not found (404):`, errorInfo);
    } else if (err.name === 'TimeoutError') {
      console.error(`⏱️ ${endpoint} request timeout:`, errorInfo);
    } else {
      console.error(`❌ ${endpoint} request failed:`, errorInfo);
    }
    
    return of(null);
  }

  /**
   * OPTIMIZED: Batch load summary cards data (footfall + dwell) with shared parameters
   * This reduces redundant payload creation and allows parallel loading
   * @param fromUtc Start time in UTC milliseconds
   * @param toUtc End time in UTC milliseconds
   * @returns Observable with footfall and dwell data
   */
  getSummaryCardsBatch(fromUtc?: number, toUtc?: number): Observable<{
    footfall: any;
    dwell: any;
  }> {
    const finalPayload = this.createSharedPayload(fromUtc, toUtc);
    
    // Execute both requests in parallel using forkJoin for maximum speed
    // Each observable handles its own errors and returns null if it fails
    // forkJoin will complete successfully with null values for failed requests
    return forkJoin({
      footfall: this.http.post<any>(`${this.base}/api/analytics/footfall`, finalPayload).pipe(
        timeout(this.REQUEST_TIMEOUT),
        tap(res => {
          // Response logged only for debugging - removed to reduce console noise
          if (res?.siteId) {
            this.auth.setSiteId(res.siteId);
          }
        }),
        // OPTIMIZATION: Retry transient network errors (up to 1 retry with 500ms delay)
        retry({
          count: 1,
          delay: (error, retryCount) => {
            // Only retry on network errors or 5xx errors, not on 4xx or timeouts
            if (error.name === 'TimeoutError' || (error.status && error.status >= 500)) {
              return of(null).pipe(delay(500));
            }
            throw error;
          }
        }),
        catchError(err => {
          console.error('❌ API ERROR: /api/analytics/footfall', {
            url: `${this.base}/api/analytics/footfall`,
            error: err,
            timestamp: new Date().toISOString()
          });
          return this.handleApiError(err, 'Footfall', `${this.base}/api/analytics/footfall`);
        })
      ),
      dwell: this.http.post<any>(`${this.base}/api/analytics/dwell`, finalPayload).pipe(
        timeout(this.REQUEST_TIMEOUT),
        tap(res => {
          // Response logged only for debugging - removed to reduce console noise
          if (res?.siteId) {
            this.auth.setSiteId(res.siteId);
          }
        }),
        // OPTIMIZATION: Retry transient network errors (up to 1 retry with 500ms delay)
        retry({
          count: 1,
          delay: (error, retryCount) => {
            if (error.name === 'TimeoutError' || (error.status && error.status >= 500)) {
              return of(null).pipe(delay(500));
            }
            throw error;
          }
        }),
        catchError(err => {
          console.error('❌ API ERROR: /api/analytics/dwell', {
            url: `${this.base}/api/analytics/dwell`,
            error: err,
            timestamp: new Date().toISOString()
          });
          return this.handleApiError(err, 'Dwell', `${this.base}/api/analytics/dwell`);
        })
      )
    }).pipe(
      tap(results => {
        // Combined response logged only for debugging - removed to reduce console noise
      }),
      // OPTIMIZATION: Cache batch results for same payload
      shareReplay(1),
      // Add catchError at forkJoin level as additional safety net
      catchError(err => {
        console.error('❌ getSummaryCardsBatch: forkJoin error:', err);
        // Return default values if forkJoin itself fails
        return of({ footfall: null, dwell: null });
      })
    );
  }

  /**
   * OPTIMIZED: Batch load charts data (occupancy + demographics) with shared parameters
   * This reduces redundant payload creation and allows parallel loading
   * @param fromUtc Start time in UTC milliseconds
   * @param toUtc End time in UTC milliseconds
   * @returns Observable with occupancy and demographics data
   */
  getChartsBatch(fromUtc?: number, toUtc?: number): Observable<{
    occupancy: any;
    demographics: any;
  }> {
    const finalPayload = this.createSharedPayload(fromUtc, toUtc);
    
    // Execute both requests in parallel using forkJoin for maximum speed
    // Each observable handles its own errors and returns null if it fails
    // forkJoin will complete successfully with null values for failed requests
    return forkJoin({
      occupancy: this.http.post<any>(`${this.base}/api/analytics/occupancy`, finalPayload).pipe(
        timeout(this.REQUEST_TIMEOUT),
        tap(res => {
          // Response logged only for debugging - removed to reduce console noise
        }),
        // OPTIMIZATION: Retry transient network errors
        retry({
          count: 1,
          delay: (error, retryCount) => {
            if (error.name === 'TimeoutError' || (error.status && error.status >= 500)) {
              return of(null).pipe(delay(500));
            }
            throw error;
          }
        }),
        catchError(err => {
          console.error('❌ API ERROR: /api/analytics/occupancy', {
            url: `${this.base}/api/analytics/occupancy`,
            error: err,
            timestamp: new Date().toISOString()
          });
          return this.handleApiError(err, 'Occupancy', `${this.base}/api/analytics/occupancy`);
        })
      ),
      demographics: this.http.post<any>(`${this.base}/api/analytics/demographics`, finalPayload).pipe(
        timeout(this.REQUEST_TIMEOUT),
        tap(res => {
          // Response logged only for debugging - removed to reduce console noise
        }),
        // OPTIMIZATION: Retry transient network errors
        retry({
          count: 1,
          delay: (error, retryCount) => {
            if (error.name === 'TimeoutError' || (error.status && error.status >= 500)) {
              return of(null).pipe(delay(500));
            }
            throw error;
          }
        }),
        catchError(err => {
          console.error('❌ API ERROR: /api/analytics/demographics', {
            url: `${this.base}/api/analytics/demographics`,
            error: err,
            timestamp: new Date().toISOString()
          });
          return this.handleApiError(err, 'Demographics', `${this.base}/api/analytics/demographics`);
        })
      )
    }).pipe(
      tap(results => {
        // Combined response logged only for debugging - removed to reduce console noise
      }),
      // OPTIMIZATION: Cache batch results for same payload
      shareReplay(1),
      // Add catchError at forkJoin level as additional safety net
      catchError(err => {
        console.error('❌ getChartsBatch: forkJoin error:', err);
        // Return default values if forkJoin itself fails
        return of({ occupancy: null, demographics: null });
      })
    );
  }

  /**
   * OPTIMIZED: Batch load all analytics endpoints with shared parameters
   * This reduces redundant payload creation and allows parallel loading with shared date range
   * Use this when you need all 4 endpoints (footfall, dwell, occupancy, demographics)
   * @param fromUtc Start time in UTC milliseconds
   * @param toUtc End time in UTC milliseconds
   * @returns Observable with all analytics data
   */
  getAnalyticsBatch(fromUtc?: number, toUtc?: number): Observable<{
    footfall: any;
    dwell: any;
    occupancy: any;
    demographics: any;
  }> {
    const finalPayload = this.createSharedPayload(fromUtc, toUtc);

    // Execute all requests in parallel using forkJoin for maximum speed
    return forkJoin({
      footfall: this.http.post<any>(`${this.base}/api/analytics/footfall`, finalPayload).pipe(
        timeout(this.REQUEST_TIMEOUT),
        tap(res => {
          if (res?.siteId) {
            this.auth.setSiteId(res.siteId);
          }
        }),
        catchError(err => this.handleApiError(err, 'Footfall', `${this.base}/api/analytics/footfall`))
      ),
      dwell: this.http.post<any>(`${this.base}/api/analytics/dwell`, finalPayload).pipe(
        timeout(this.REQUEST_TIMEOUT),
        tap(res => {
          if (res?.siteId) {
            this.auth.setSiteId(res.siteId);
          }
        }),
        catchError(err => this.handleApiError(err, 'Dwell', `${this.base}/api/analytics/dwell`))
      ),
      occupancy: this.http.post<any>(`${this.base}/api/analytics/occupancy`, finalPayload).pipe(
        timeout(this.REQUEST_TIMEOUT),
        catchError(err => this.handleApiError(err, 'Occupancy', `${this.base}/api/analytics/occupancy`))
      ),
      demographics: this.http.post<any>(`${this.base}/api/analytics/demographics`, finalPayload).pipe(
        timeout(this.REQUEST_TIMEOUT),
        catchError(err => this.handleApiError(err, 'Demographics', `${this.base}/api/analytics/demographics`))
      )
    });
  }

  clearCaches(): void {
    // Cancel any pending requests
    this.cancelPendingRequests$.next();
    
    // Clear all caches
    this.footfallCache$ = undefined;
    this.dwellCache$ = undefined;
    this.occupancyCache$ = undefined;
    this.demographicsCache$ = undefined;
    this.entryExitCache.clear();
    
    // Invalidate cached day payload
    this.cachedDayPayload = null;
  }
  
  /**
   * OPTIMIZATION: Get cancel subject for request cancellation
   * Use with takeUntil() operator to cancel requests when needed
   */
  getCancelSubject(): Subject<void> {
    return this.cancelPendingRequests$;
  }
}
