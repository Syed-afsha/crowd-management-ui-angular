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
        if (!this.auth.getSiteId() && sites && sites.length > 0 && sites[0]?.siteId) {
          this.auth.setSiteId(sites[0].siteId);
        }
      }),
      catchError(error => {
        console.error('Failed to fetch sites:', error);
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
    const payload = {
      siteId: siteId || '',
      fromUtc: now - this.TWELVE_HOURS_MS,
      toUtc: now,
      ...extra
    };
    return payload;
  }

  private entryExitPayload(pageNumber: number, pageSize: number) {
    const now = Date.now();
    const siteId = this.auth.getSiteId();
    return {
      siteId: siteId || '',
      fromUtc: now - this.SIX_HOURS_MS,
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
        // Only log non-timeout errors to reduce console noise
        if (err.name !== 'TimeoutError') {
          console.error('Footfall request failed:', err);
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
        // Only log non-timeout errors to reduce console noise
        if (err.name !== 'TimeoutError') {
          console.error('Dwell request failed:', err);
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
        if (err.status === 404) {
          return of(null);
        }
        // Only log non-timeout errors to reduce console noise
        if (err.name !== 'TimeoutError') {
          console.error('Occupancy request failed:', err);
        }
        return of(null);
      }),
      shareReplay(1)
    );
  }

  private createDemographicsCache() {
    const payload = this.payload();
    return this.http.post<any>(`${this.base}/api/analytics/demographics`, payload).pipe(
      timeout(this.REQUEST_TIMEOUT),
      catchError(err => {
        if (err.status === 404) {
          return of(null);
        }
        // Only log non-timeout errors to reduce console noise
        if (err.name !== 'TimeoutError') {
          console.error('Demographics request failed:', err);
        }
        return of(null);
      }),
      shareReplay(1)
    );
  }

  getFootfall() {
    if (!this.footfallCache$) {
      this.footfallCache$ = this.createFootfallCache();
    }
    return this.footfallCache$;
  }

  getDwell() {
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
        // Only log non-timeout errors to reduce console noise
        if (err.name !== 'TimeoutError') {
          console.error('Entry-exit request failed:', err);
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

  getOccupancy() {
    if (!this.occupancyCache$) {
      this.occupancyCache$ = this.createOccupancyCache();
    }
    return this.occupancyCache$;
  }

  getDemographics() {
    if (!this.demographicsCache$) {
      this.demographicsCache$ = this.createDemographicsCache();
    }
    return this.demographicsCache$;
  }

  clearCaches(): void {
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
