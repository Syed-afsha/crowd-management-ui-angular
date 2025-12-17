import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { tap, catchError, of, shareReplay, timeout } from 'rxjs';
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

  constructor(
    private http: HttpClient,
    private auth: AuthService
  ) {}

  private createSitesCache() {
    return this.http.get<any[]>(`${this.base}/api/sites`).pipe(
      tap(sites => {
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
        console.error('❌ Failed to fetch sites:', errorInfo);
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
    // For Overall Occupancy: use 8:00 to 18:00 (10 hours) as per prototype
    // Use local time (user expects 8:00-18:00 in their timezone)
    const today = new Date();
    today.setHours(8, 0, 0, 0);
    const fromUtc = today.getTime(); // This is already in UTC milliseconds
    const endOfDay = new Date();
    endOfDay.setHours(18, 0, 0, 0);
    const toUtc = Math.min(now, endOfDay.getTime()); // End at 18:00 local time or current time, whichever is earlier
    
    const payload = {
      siteId: siteId || '',
      fromUtc,
      toUtc,
      ...extra
    };
    return payload;
  }

  private entryExitPayload(pageNumber: number, pageSize: number) {
    const now = Date.now();
    const siteId = this.auth.getSiteId();
    // OPTIMIZATION: Reduce time range for entry-exit to improve performance
    // Use 30 minutes instead of 1 hour for faster queries
    const THIRTY_MINUTES_MS = 30 * 60 * 1000;
    return {
      siteId: siteId || '',
      fromUtc: now - THIRTY_MINUTES_MS,
      toUtc: now,
      pageNumber,
      pageSize
    };
  }

  private createFootfallCache() {
    const payload = this.payload();
    return this.http.post<any>(`${this.base}/api/analytics/footfall`, payload).pipe(
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

  private createEntryExitCache(pageNumber: number, pageSize: number) {
    const payload = this.entryExitPayload(pageNumber, pageSize);
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
      }),
      shareReplay(1)
    );
  }

  getEntryExit(pageNumber = 1, pageSize = 50) {
    const cacheKey = `${pageNumber}-${pageSize}`;
    
    if (!this.entryExitCache.has(cacheKey)) {
      this.entryExitCache.set(cacheKey, this.createEntryExitCache(pageNumber, pageSize));
    }
    
    return this.entryExitCache.get(cacheKey)!;
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

  clearCaches(): void {
    this.sitesCache$ = undefined;
    this.footfallCache$ = undefined;
    this.dwellCache$ = undefined;
    this.occupancyCache$ = undefined;
    this.demographicsCache$ = undefined;
    this.entryExitCache.clear();
  }

  startSimulation() {
    return this.http.get<any>(`${this.base}/api/sim/start`);
  }

  stopSimulation() {
    return this.http.get<any>(`${this.base}/api/sim/stop`);
  }
}
