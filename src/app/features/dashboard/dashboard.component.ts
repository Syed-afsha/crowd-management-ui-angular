import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule, provideNativeDateAdapter } from '@angular/material/core';
import { MatButtonModule } from '@angular/material/button';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { ApiService } from '../../core/services/api.service';
import { SocketService } from '../../core/services/socket.service';
import { SiteService } from '../../core/services/site.service';
import { NotificationService, Alert } from '../../core/services/notification.service';
import { AuthService } from '../../core/services/auth.service';
import { NgxChartsModule } from '@swimlane/ngx-charts';
import { Subscription, forkJoin, debounceTime, distinctUntilChanged, catchError, of } from 'rxjs';
import { curveCardinal } from 'd3-shape';

@Component({
  standalone: true,
  selector: 'app-dashboard',
  imports: [CommonModule, NgxChartsModule, MatIconModule, MatDatepickerModule, MatNativeDateModule, MatButtonModule, MatInputModule, MatFormFieldModule],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class DashboardComponent implements OnInit, OnDestroy {
  loading = true;
  loadingFootfall = false;
  loadingDwell = false;
  loadingOccupancy = false;
  loadingDemographics = false;
  liveOccupancy = 0;
  todaysFootfall = 0;
  avgDwellTime = 0;

  previousFootfall = 0;
  previousDwellTime = 0;
  occupancyChartData: any[] = [];
  demographicsChartData: any[] = [];
  demographicsAnalysisChartData: any[] = [];
  chartOptions = {
    showXAxis: true,
    showYAxis: true,
    gradient: false,
    showLegend: false, // Removed legend from Overall Occupancy chart
    showXAxisLabel: true,
    showYAxisLabel: true,
    xAxisLabel: 'Time',
    timeline: false, // Disable timeline for better performance
    autoScale: true,
    view: [1200, 300] as [number, number], // Stretched width for Overall Occupancy
    animations: false // Explicitly disable animations
  };
  demographicsChartOptions = {
    showXAxis: true,
    showYAxis: true,
    gradient: false,
    showLegend: true,
    showXAxisLabel: true,
    showYAxisLabel: true,
    xAxisLabel: 'Time',
    timeline: false,
    autoScale: true,
    view: [600, 300] as [number, number], // Reduced width to fit container and prevent cutoff
    animations: false
  };
  pieChartOptions = {
    showLegend: true,
    view: [340, 240] as [number, number], // Slightly increased size
    animations: false // Explicitly disable animations
  };

  curve = curveCardinal.tension(0.5); // Smooth wavy curves

  selectedDate: Date = new Date();
  datePickerOpen = false;

  private socketSubscriptions: Subscription[] = [];
  private httpSubscriptions: Subscription[] = [];
  private footfallRefreshPending = false;

  constructor(
    private api: ApiService, 
    private socket: SocketService,
    private siteService: SiteService,
    private notificationService: NotificationService,
    private auth: AuthService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    // Initialize notification service with today's date
    this.notificationService.setSelectedDate(this.selectedDate);
    
    // Always wait for SiteService notification to ensure siteId is validated
    // This prevents loading with invalid/stale siteId from previous session
    let hasLoadedInitialData = false;
    
    const initialSiteSub = this.siteService.siteChange$.subscribe(() => {
      // Only load once on initial site change (after login/sites loaded)
      if (!hasLoadedInitialData) {
        hasLoadedInitialData = true;
        this.loadDashboardData();
        // Unsubscribe after first load to avoid duplicate loads
        initialSiteSub.unsubscribe();
      }
    });
    this.httpSubscriptions.push(initialSiteSub);
    
    this.setupSocketListeners();
    
    // Listen for subsequent site changes and reload data
    const siteChangeSub = this.siteService.siteChange$.subscribe(() => {
      // Skip if this is the initial load (handled above)
      if (hasLoadedInitialData) {
        // Clear API service caches for fresh data
        this.api.clearCaches();
        // Reload data (cache is already cleared by SiteService)
        this.loadDashboardData();
      }
    });
    this.httpSubscriptions.push(siteChangeSub);
  }

  ngOnDestroy(): void {
    this.socketSubscriptions.forEach(sub => sub.unsubscribe());
    this.socketSubscriptions = [];
    this.httpSubscriptions.forEach(sub => sub.unsubscribe());
    this.httpSubscriptions = [];
  }

  private loadDashboardData(): void {
    // Unsubscribe from any pending HTTP requests to prevent race conditions
    this.httpSubscriptions.forEach(sub => {
      if (sub && !sub.closed) {
        sub.unsubscribe();
      }
    });
    this.httpSubscriptions = [];
    
    // OPTIMIZATION: Don't reset data immediately - keep existing data visible while loading
    // This provides instant perceived performance (progressive loading)
    // Only set loading flags for individual sections
    this.loadingFootfall = true;
    this.loadingDwell = true;
    this.loadingOccupancy = true;
    this.loadingDemographics = true;
    // Keep main loading false initially - will be set to true only if no cached data exists
    this.loading = false;
    this.cdr.markForCheck();
    
    // Calculate date range for API
    // API expects: { siteId, fromUtc, toUtc } where fromUtc/toUtc are UTC milliseconds (numbers)
    // Use UTC time directly - backend handles timezone conversion based on siteId
    
    // Get selected date in UTC
    const selectedDate = new Date(this.selectedDate);
    const selectedYear = selectedDate.getUTCFullYear();
    const selectedMonth = selectedDate.getUTCMonth();
    const selectedDay = selectedDate.getUTCDate();
    
    // Check if selected date is today (in UTC)
    const now = new Date();
    const todayYear = now.getUTCFullYear();
    const todayMonth = now.getUTCMonth();
    const todayDay = now.getUTCDate();
    const isToday = selectedYear === todayYear && selectedMonth === todayMonth && selectedDay === todayDay;
    
    // Create 8:00 AM and 6:00 PM UTC for the selected date
    // Date.UTC() creates a date in UTC timezone
    let fromUtc = Date.UTC(selectedYear, selectedMonth, selectedDay, 8, 0, 0, 0);  // 8:00 AM UTC
    let toUtc = isToday ? Math.min(Date.now(), Date.UTC(selectedYear, selectedMonth, selectedDay, 18, 0, 0, 0)) : Date.UTC(selectedYear, selectedMonth, selectedDay, 18, 0, 0, 0);  // 6:00 PM UTC or current time
    
    // Ensure valid time range
    if (fromUtc >= toUtc) {
      // If invalid, adjust to valid range
      if (isToday && Date.now() < fromUtc) {
        // Before 8 AM UTC today - use last hour
        toUtc = Date.now();
        fromUtc = Math.max(toUtc - (60 * 60 * 1000), fromUtc - (24 * 60 * 60 * 1000));
      } else {
        // Ensure minimum 1 hour range
        toUtc = Math.max(toUtc, fromUtc + (60 * 60 * 1000));
      }
    }
    
    // Log for debugging
    console.log('📅 API date range (UTC):', {
      selectedDate: `${selectedYear}-${String(selectedMonth + 1).padStart(2, '0')}-${String(selectedDay).padStart(2, '0')}`,
      isToday,
      fromUtc: fromUtc,
      toUtc: toUtc,
      fromUtcISO: new Date(fromUtc).toISOString(),
      toUtcISO: new Date(toUtc).toISOString(),
      durationHours: ((toUtc - fromUtc) / (60 * 60 * 1000)).toFixed(2)
    });
    
    // PHASE 1: High Priority - Summary Cards (Footfall & Dwell)
    // These APIs power summary cards and must load first
    const phase1Sub = forkJoin({
      footfall: this.api.getFootfall(fromUtc, toUtc).pipe(
        catchError(err => {
          const errorInfo = {
            type: err.name || 'HTTP Error',
            status: err.status,
            statusText: err.statusText,
            message: err.message,
            error: err.error,
            endpoint: 'footfall',
            timestamp: new Date().toISOString()
          };
          if (err.name === 'TimeoutError') {
            console.error('⏱️ Dashboard: Footfall request timeout:', errorInfo);
          } else {
            console.error('❌ Dashboard: Error loading footfall:', errorInfo);
          }
          return of(null);
        })
      ),
      dwell: this.api.getDwell(fromUtc, toUtc).pipe(
        catchError(err => {
          const errorInfo = {
            type: err.name || 'HTTP Error',
            status: err.status,
            statusText: err.statusText,
            message: err.message,
            error: err.error,
            endpoint: 'dwell',
            timestamp: new Date().toISOString()
          };
          if (err.name === 'TimeoutError') {
            console.error('⏱️ Dashboard: Dwell request timeout:', errorInfo);
          } else {
            console.error('❌ Dashboard: Error loading dwell:', errorInfo);
          }
          return of(null);
        })
      )
    }).subscribe({
      next: (phase1Results) => {
        // Process footfall
        if (phase1Results.footfall) {
          const footfallValue = phase1Results.footfall?.footfall ?? phase1Results.footfall?.count ?? phase1Results.footfall?.todaysFootfall ?? phase1Results.footfall?.totalFootfall ?? 0;
          this.todaysFootfall = typeof footfallValue === 'number' ? Math.round(footfallValue) : parseInt(footfallValue) || 0;
          this.previousFootfall = phase1Results.footfall?.previousFootfall ?? phase1Results.footfall?.previousCount ?? phase1Results.footfall?.yesterdaysFootfall ?? 0;
          this._footfallChange = undefined; // Invalidate cache
        }
        this.loadingFootfall = false;
        
        // Process dwell
        if (phase1Results.dwell) {
          const dwellValue = phase1Results.dwell?.avgDwellMinutes ?? phase1Results.dwell?.avgDwellTime ?? phase1Results.dwell?.averageDwellTime ?? phase1Results.dwell?.dwellMinutes ?? 0;
          this.avgDwellTime = typeof dwellValue === 'number' ? Math.round(dwellValue * 10) / 10 : parseFloat(dwellValue) || 0;
          this.previousDwellTime = phase1Results.dwell?.previousAvgDwellMinutes ?? phase1Results.dwell?.previousAvgDwellTime ?? phase1Results.dwell?.previousAverageDwellTime ?? 0;
          this._dwellTimeChange = undefined; // Invalidate cache
        }
        this.loadingDwell = false;
        
        // Phase 1 complete - trigger change detection for summary cards
        this.checkAllLoaded();
        this.cdr.markForCheck();
        
        // PHASE 2: Low Priority - Charts (Occupancy & Demographics)
        // These are heavy APIs and load in background after Phase 1 completes
        // Must NOT block summary cards
        const phase2Sub = forkJoin({
          occupancy: this.api.getOccupancy(fromUtc, toUtc).pipe(
            catchError(err => {
              const errorInfo = {
                type: err.name || 'HTTP Error',
                status: err.status,
                statusText: err.statusText,
                message: err.message,
                error: err.error,
                endpoint: 'occupancy',
                timestamp: new Date().toISOString()
              };
              if (err.status === 404) {
                console.warn('⚠️ Dashboard: Occupancy data not found (404):', errorInfo);
              } else if (err.name === 'TimeoutError') {
                console.error('⏱️ Dashboard: Occupancy request timeout:', errorInfo);
              } else {
                console.error('❌ Dashboard: Error loading occupancy:', errorInfo);
              }
              return of(null);
            })
          ),
          demographics: this.api.getDemographics(fromUtc, toUtc).pipe(
            catchError(err => {
              const errorInfo = {
                type: err.name || 'HTTP Error',
                status: err.status,
                statusText: err.statusText,
                message: err.message,
                error: err.error,
                endpoint: 'demographics',
                timestamp: new Date().toISOString()
              };
              if (err.status === 404) {
                console.warn('⚠️ Dashboard: Demographics data not found (404):', errorInfo);
              } else if (err.name === 'TimeoutError') {
                console.error('⏱️ Dashboard: Demographics request timeout:', errorInfo);
              } else {
                console.error('❌ Dashboard: Error loading demographics:', errorInfo);
              }
              return of(null);
            })
          )
        }).subscribe({
          next: (phase2Results) => {
            // Process occupancy
            if (phase2Results.occupancy) {
              this.processOccupancyData(phase2Results.occupancy);
              // Set initial live occupancy from the most recent bucket only if selected date is today
              if (this.isSelectedDateToday()) {
                if (phase2Results.occupancy.buckets && Array.isArray(phase2Results.occupancy.buckets) && phase2Results.occupancy.buckets.length > 0) {
                  const latestBucket = phase2Results.occupancy.buckets[phase2Results.occupancy.buckets.length - 1];
                  const latestOccupancy = Number(latestBucket.avg || latestBucket.occupancy || latestBucket.value || 0);
                  if (latestOccupancy > 0) {
                    this.liveOccupancy = Math.round(latestOccupancy);
                  }
                } else {
                  // Empty buckets array - no live data
                  this.liveOccupancy = 0;
                }
              } else {
                // For past or future dates, live occupancy should be 0
                this.liveOccupancy = 0;
              }
            } else {
              this.occupancyChartData = [];
              this.liveOccupancy = 0;
            }
            this.loadingOccupancy = false;
            console.log('✅ Occupancy loading complete. Chart data length:', this.occupancyChartData.length, 'Live occupancy:', this.liveOccupancy);
            
            // Process demographics
            if (phase2Results.demographics) {
              this.processDemographicsData(phase2Results.demographics);
              this.processDemographicsAnalysisData(phase2Results.demographics);
            } else {
              this.demographicsChartData = [];
              this.demographicsAnalysisChartData = [];
            }
            this.loadingDemographics = false;
            console.log('✅ Demographics loading complete. Chart data length:', this.demographicsChartData.length, 'Analysis data length:', this.demographicsAnalysisChartData.length);
            
            // Phase 2 complete
            this.checkAllLoaded();
            this.cdr.markForCheck();
          },
          error: (err) => {
            // Handle Phase 2 errors
            const errorInfo = {
              type: err.name || 'HTTP Error',
              status: err.status,
              statusText: err.statusText,
              message: err.message,
              error: err.error,
              context: 'forkJoin - Phase 2 (charts)',
              timestamp: new Date().toISOString()
            };
            console.error('❌ Dashboard: Error loading Phase 2 data (charts):', errorInfo);
            this.loadingOccupancy = false;
            this.loadingDemographics = false;
            this.checkAllLoaded();
            this.cdr.markForCheck();
          }
        });
        
        this.httpSubscriptions.push(phase2Sub);
      },
      error: (err) => {
        // Handle Phase 1 errors
        const errorInfo = {
          type: err.name || 'HTTP Error',
          status: err.status,
          statusText: err.statusText,
          message: err.message,
          error: err.error,
          context: 'forkJoin - Phase 1 (summary cards)',
          timestamp: new Date().toISOString()
        };
        console.error('❌ Dashboard: Error loading Phase 1 data (summary cards):', errorInfo);
        this.loadingFootfall = false;
        this.loadingDwell = false;
        this.checkAllLoaded();
        this.cdr.markForCheck();
        
        // Even if Phase 1 fails, try Phase 2 (charts) in background
        const phase2Sub = forkJoin({
          occupancy: this.api.getOccupancy(fromUtc, toUtc).pipe(catchError(() => of(null))),
          demographics: this.api.getDemographics(fromUtc, toUtc).pipe(catchError(() => of(null)))
        }).subscribe({
          next: (phase2Results) => {
            if (phase2Results.occupancy) {
              this.processOccupancyData(phase2Results.occupancy);
            } else {
              this.occupancyChartData = [];
            }
            this.loadingOccupancy = false;
            
            if (phase2Results.demographics) {
              this.processDemographicsData(phase2Results.demographics);
              this.processDemographicsAnalysisData(phase2Results.demographics);
            } else {
              this.demographicsChartData = [];
              this.demographicsAnalysisChartData = [];
            }
            this.loadingDemographics = false;
            this.checkAllLoaded();
            this.cdr.markForCheck();
          },
          error: () => {
            this.loadingOccupancy = false;
            this.loadingDemographics = false;
            this.checkAllLoaded();
            this.cdr.markForCheck();
          }
        });
        this.httpSubscriptions.push(phase2Sub);
      }
    });
    
    this.httpSubscriptions.push(phase1Sub);
  }
  
  private checkAllLoaded(): void {
    // Check if all requests have completed (successfully or with error)
    if (!this.loadingFootfall && !this.loadingDwell && !this.loadingOccupancy && !this.loadingDemographics) {
      this.loading = false;
      this.cdr.markForCheck();
    }
  }

  private processOccupancyData(data: any): void {
    const processSeries = (items: any[]) => {
      if (!items || items.length === 0) {
        return [];
      }
      
      // Data sampling: Take every Nth item to reduce data points for faster rendering
      // If more than 20 points, sample to keep max 20 points (ultra-optimized for 1-2 second load)
      const maxPoints = 20;
      const step = items.length > maxPoints ? Math.ceil(items.length / maxPoints) : 1;
      const sampledItems = items.filter((_, index) => index % step === 0);
      
      // Pre-allocate array with exact size for better performance
      const result: any[] = new Array(sampledItems.length);
      let resultIndex = 0;
      for (const item of sampledItems) {
        // Handle different time field names: utc, local, timestamp, hour, time
        let time = '';
        if (item.local) {
          // Extract time from local string (e.g., "15/12/2025 09:00:00" -> "09:00")
          const localMatch = item.local.match(/(\d{2}:\d{2}):\d{2}/);
          if (localMatch) {
            time = localMatch[1];
          } else {
            time = this.formatTime(item.local);
          }
        } else {
          time = this.formatTime(item.utc || item.timestamp || item.hour || item.time);
        }
        if (time) {
          const value = Number(item.avg || item.occupancy || item.count || item.value || item.average || 0);
          // Round occupancy to whole number (can't have fractional people)
          result[resultIndex++] = { name: time, value: isNaN(value) ? 0 : Math.round(value) };
        }
      }
      // Trim to actual size
      result.length = resultIndex;
      return result;
    };

    let series: any[] = [];
    
    if (Array.isArray(data)) {
      series = processSeries(data);
    } else if (data?.timeseries && Array.isArray(data.timeseries)) {
      series = processSeries(data.timeseries);
    } else if (data?.data && Array.isArray(data.data)) {
      series = processSeries(data.data);
    } else if (data?.buckets && Array.isArray(data.buckets)) {
      series = processSeries(data.buckets);
    }
    
    // Only set chart data if series has data points
    if (series.length > 0) {
      this.occupancyChartData = [{ name: 'Occupancy', series }];
      console.log('✅ Occupancy chart data loaded:', this.occupancyChartData.length, 'series with', series.length, 'points');
    } else {
      this.occupancyChartData = [];
      console.warn('⚠️ Occupancy data processed but no valid series found. Data structure:', data);
    }
    this.cdr.markForCheck();
  }

  private processDemographicsData(data: any): void {
    const processSeries = (items: any[]) => {
      if (!items || items.length === 0) {
        return [];
      }
      
      // Data sampling: Take every Nth item to reduce data points for faster rendering
      // If more than 20 points, sample to keep max 20 points (ultra-optimized for 1-2 second load)
      const maxPoints = 20;
      const step = items.length > maxPoints ? Math.ceil(items.length / maxPoints) : 1;
      const sampledItems = items.filter((_, index) => index % step === 0);
      
      // Pre-allocate arrays for better performance
      const maleData: any[] = [];
      const femaleData: any[] = [];
      const initialSize = Math.min(sampledItems.length, 30);
      maleData.length = initialSize;
      femaleData.length = initialSize;
      let index = 0;

      for (const item of sampledItems) {
        // Handle different time field names: utc, local, timestamp, hour, time
        let time = '';
        if (item.local) {
          // Extract time from local string (e.g., "15/12/2025 09:00:00" -> "09:00")
          const localMatch = item.local.match(/(\d{2}:\d{2}):\d{2}/);
          if (localMatch) {
            time = localMatch[1];
          } else {
            time = this.formatTime(item.local);
          }
        } else {
          time = this.formatTime(item.utc || item.timestamp || item.hour || item.time);
        }
        
        if (time) {
          const maleValue = Number(item.male || item.maleCount || 0);
          const femaleValue = Number(item.female || item.femaleCount || 0);
          // Round to whole numbers (can't have fractional people)
          maleData[index] = { name: time, value: isNaN(maleValue) ? 0 : Math.round(maleValue) };
          femaleData[index] = { name: time, value: isNaN(femaleValue) ? 0 : Math.round(femaleValue) };
          index++;
        }
      }
      // Trim arrays to actual size
      maleData.length = index;
      femaleData.length = index;
      return [
        { name: 'Male', series: maleData },
        { name: 'Female', series: femaleData }
      ];
    };

    let chartData: any[] = [];
    
    if (Array.isArray(data)) {
      chartData = processSeries(data);
    } else if (data?.timeseries && Array.isArray(data.timeseries)) {
      chartData = processSeries(data.timeseries);
    } else if (data?.data && Array.isArray(data.data)) {
      chartData = processSeries(data.data);
    } else if (data?.buckets && Array.isArray(data.buckets)) {
      chartData = processSeries(data.buckets);
    }
    
    // Only set chart data if it has valid series
    if (chartData.length > 0 && chartData[0]?.series?.length > 0) {
      this.demographicsChartData = chartData;
      console.log('✅ Demographics chart data loaded:', this.demographicsChartData.length, 'series');
    } else {
      this.demographicsChartData = [];
      console.warn('⚠️ Demographics data processed but no valid series found. Data structure:', data);
    }
    this.cdr.markForCheck();
  }

  private processDemographicsAnalysisData(data: any): void {
    let buckets: any[] = [];
    
    if (Array.isArray(data)) {
      buckets = data;
    } else if (data?.buckets && Array.isArray(data.buckets)) {
      buckets = data.buckets;
    } else if (data?.timeseries && Array.isArray(data.timeseries)) {
      buckets = data.timeseries;
    } else if (data?.data && Array.isArray(data.data)) {
      buckets = data.data;
    }

    // Calculate total male and female counts
    let totalMale = 0;
    let totalFemale = 0;

    buckets.forEach((item: any) => {
      const maleValue = Number(item.male || item.maleCount || 0);
      const femaleValue = Number(item.female || item.femaleCount || 0);
      if (!isNaN(maleValue)) totalMale += maleValue;
      if (!isNaN(femaleValue)) totalFemale += femaleValue;
    });

    // Create pie chart data
    this.demographicsAnalysisChartData = [
      { name: 'Male', value: Math.round(totalMale) },
      { name: 'Female', value: Math.round(totalFemale) }
    ];
    // Invalidate memoized percentages
    this._malePercentage = undefined;
    this._femalePercentage = undefined;
    this._lastDemographicsDataLength = this.demographicsAnalysisChartData.length;
    this.cdr.markForCheck();
  }

  private formatTime(timestamp: number | string): string {
    if (!timestamp && timestamp !== 0) return '';
    
    try {
      let date: Date;
      
      // Handle number (epoch milliseconds or seconds)
      if (typeof timestamp === 'number') {
        // If it's a small number, assume it's seconds, otherwise milliseconds
        date = timestamp < 10000000000 ? new Date(timestamp * 1000) : new Date(timestamp);
      } else {
        // Handle string formats like "15/12/2025 09:00:00" (DD/MM/YYYY HH:mm:ss)
        const dateStrMatch = timestamp.match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/);
        if (dateStrMatch) {
          // Parse DD/MM/YYYY HH:mm:ss format
          const [, day, month, year, hour, minute, second] = dateStrMatch;
          date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day), parseInt(hour), parseInt(minute), parseInt(second));
        } else {
          // Try parsing directly
          date = new Date(timestamp);
        }
      }
      
      if (isNaN(date.getTime())) {
        // Try parsing as hour number (0-23)
        const hourNum = parseInt(timestamp.toString());
        if (!isNaN(hourNum) && hourNum >= 0 && hourNum <= 23) {
          return `${hourNum.toString().padStart(2, '0')}:00`;
        }
        return '';
      }
      
      return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    } catch (err) {
      console.error('❌ Dashboard: Error formatting time:', {
        error: err,
        timestamp: timestamp,
        timestampType: new Date().toISOString()
      });
      // Try to extract hour if it's a number
      const hourNum = parseInt(timestamp.toString());
      if (!isNaN(hourNum) && hourNum >= 0 && hourNum <= 23) {
        return `${hourNum.toString().padStart(2, '0')}:00`;
      }
      return '';
    }
  }

  private setupSocketListeners(): void {
    // Debounce live occupancy updates to prevent excessive re-renders
    // Note: Event name is 'live_occupancy' (underscore), not 'live-occupancy' (hyphen)
    const liveOccupancySub = this.socket.listen('live_occupancy').pipe(
      debounceTime(200), // Increased debounce to reduce re-renders
      distinctUntilChanged()
    ).subscribe({
      next: (data: any) => {
        // Handle different data formats: number, object with siteOccupancy property, etc.
        let occupancyValue = 0;
        
        if (typeof data === 'number') {
          occupancyValue = data;
        } else if (data === null || data === undefined) {
          occupancyValue = 0;
        } else if (typeof data === 'string') {
          // Try to parse string as number
          occupancyValue = parseFloat(data) || 0;
        } else if (data && typeof data === 'object') {
          // Handle array format: [{siteOccupancy: 123}] or object format: {siteOccupancy: 123}
          const dataValue = Array.isArray(data) ? data[0] : data;
          
          // Try multiple possible property names (siteOccupancy is the actual property name from the API)
          occupancyValue = Number(
            dataValue?.siteOccupancy ||  // This is the actual property name!
            dataValue?.count || 
            dataValue?.occupancy || 
            dataValue?.value || 
            dataValue?.liveOccupancy || 
            dataValue?.avg ||
            dataValue?.current ||
            dataValue?.total ||
            dataValue?.number ||
            (typeof dataValue === 'number' ? dataValue : 0)
          );
        }
        
        // Only update if we got a valid number AND selected date is today
        // For past or future dates, live occupancy should remain 0
        if (!isNaN(occupancyValue) && occupancyValue >= 0 && this.isSelectedDateToday()) {
          this.liveOccupancy = Math.round(occupancyValue);
          this.cdr.markForCheck();
        } else if (!this.isSelectedDateToday()) {
          // Ensure live occupancy is 0 for past/future dates
          this.liveOccupancy = 0;
          this.cdr.markForCheck();
        }
      },
      error: (err) => {
        const errorInfo = {
          type: err.name || 'Socket Error',
          message: err.message,
          error: err,
          event: 'live_occupancy',
          timestamp: new Date().toISOString()
        };
        console.error('❌ Dashboard: Socket subscription error (live_occupancy):', errorInfo);
      }
    });
    this.socketSubscriptions.push(liveOccupancySub);

    const alertSub = this.socket.listen('alert').subscribe({
      next: (alertData: any) => {
        this.handleAlert(alertData);
      },
      error: (err) => {
        const errorInfo = {
          type: err.name || 'Socket Error',
          message: err.message,
          error: err,
          event: 'alert',
          timestamp: new Date().toISOString()
        };
        console.error('❌ Dashboard: Socket subscription error (alert):', errorInfo);
      }
    });
    this.socketSubscriptions.push(alertSub);
  }

  private handleAlert(alertData: any): void {
    // Check direction field first (e.g., "zone-exit", "zone-entry")
    const direction = alertData.direction || '';
    // Also check actionType as fallback
    const actionTypeRaw = alertData.actionType || alertData.type || alertData.action || alertData.eventType || alertData.event || '';
    const actionType = actionTypeRaw ? actionTypeRaw.toString().toLowerCase().trim() : '';
    
    // Use zone name if available, otherwise zone ID, otherwise fallback
    const zone = alertData.zoneName || alertData.zone || alertData.zoneId || 'Unknown Zone';
    // Use site name if available, otherwise site ID, otherwise fallback
    const site = alertData.siteName || alertData.site || alertData.siteId || 'Unknown Site';
    // Use person name if available
    const personName = alertData.personName || alertData.name || '';
    const severity = alertData.severity || alertData.level || 'info';
    const timestamp = alertData.ts || alertData.timestamp || Date.now();

    // Determine if it's entry or exit from direction field (e.g., "zone-exit", "zone-entry")
    const directionLower = direction.toString().toLowerCase();
    const isEntry = directionLower.includes('entry') || directionLower.includes('enter') || 
                    actionType === 'entry' || actionType === 'enter' || actionType === 'in' || 
                    actionType.includes('entry') || actionType.includes('enter');
    const isExit = directionLower.includes('exit') || directionLower.includes('leave') || 
                   actionType === 'exit' || actionType === 'leave' || actionType === 'out' || 
                   actionType.includes('exit') || actionType.includes('leave');

    // Build a more readable message
    let message = '';
    if (personName) {
      if (isEntry) {
        message = `${personName} entered ${zone}`;
      } else if (isExit) {
        message = `${personName} exited ${zone}`;
      } else {
        // Default to exit if we can't determine
        message = `${personName} exited ${zone}`;
      }
    } else {
      // No person name, use action type and zone
      if (isEntry) {
        message = `ENTRY: ${zone}`;
      } else if (isExit) {
        message = `EXIT: ${zone}`;
      } else {
        message = zone;
      }
      if (site && site !== 'Unknown Site' && !site.includes('-') && !site.match(/^[0-9a-f]{8}-/i)) {
        message += ` (${site})`;
      }
    }

    // Store normalized actionType for use in notification bell
    const normalizedActionType = isEntry ? 'entry' : 'exit';

    const alert: Alert = {
      actionType: normalizedActionType,
      zone,
      site,
      severity,
      timestamp,
      message: message,
      raw: alertData
    };

    // Only add notifications if selected date is today
    // Notifications are real-time and should only appear for today
    if (this.isSelectedDateToday()) {
      this.notificationService.addAlert(alert);
    }

    if (severity === 'critical') {
      console.warn('⚠️ Critical alert received:', alert.message);
    }

    // Debounce footfall refresh to prevent excessive API calls
    if (actionType === 'entry' || actionType === 'exit') {
      if (!this.footfallRefreshPending) {
        this.footfallRefreshPending = true;
        setTimeout(() => {
          const footfallRefreshSub = this.api.getFootfall().subscribe({
            next: (res) => {
              const footfallValue = res.footfall ?? res.count ?? res.todaysFootfall ?? res.totalFootfall ?? 0;
              this.todaysFootfall = typeof footfallValue === 'number' ? Math.round(footfallValue) : parseInt(footfallValue) || 0;
              this.previousFootfall = res.previousFootfall ?? res.previousCount ?? res.yesterdaysFootfall ?? 0;
              // Invalidate cached computed value
              this._footfallChange = undefined;
              this.footfallRefreshPending = false;
              this.cdr.markForCheck();
            },
            error: (err) => {
              const errorInfo = {
                type: err.name || 'HTTP Error',
                status: err.status,
                statusText: err.statusText,
                message: err.message,
                error: err.error,
                context: 'footfall refresh after alert',
                timestamp: new Date().toISOString()
              };
              console.error('❌ Dashboard: Error refreshing footfall after alert:', errorInfo);
              this.footfallRefreshPending = false;
            }
          });
          this.httpSubscriptions.push(footfallRefreshSub);
        }, 3000); // Debounce for 3 seconds to reduce API calls
      }
    }
  }


  // Memoized computed values to avoid recalculating on every change detection
  private _footfallChange?: { value: number; isPositive: boolean };
  private _dwellTimeChange?: { value: number; isPositive: boolean };

  getFootfallChange(): { value: number; isPositive: boolean } {
    // Recalculate only if values changed
    if (this._footfallChange === undefined || 
        this._footfallChange.value !== this.calculateFootfallChange().value) {
      this._footfallChange = this.calculateFootfallChange();
    }
    return this._footfallChange;
  }

  private calculateFootfallChange(): { value: number; isPositive: boolean } {
    if (this.previousFootfall === 0) return { value: 0, isPositive: true };
    const change = ((this.todaysFootfall - this.previousFootfall) / this.previousFootfall) * 100;
    return { value: Math.abs(change), isPositive: change >= 0 };
  }

  getDwellTimeChange(): { value: number; isPositive: boolean } {
    // Recalculate only if values changed
    if (this._dwellTimeChange === undefined || 
        this._dwellTimeChange.value !== this.calculateDwellTimeChange().value) {
      this._dwellTimeChange = this.calculateDwellTimeChange();
    }
    return this._dwellTimeChange;
  }

  private calculateDwellTimeChange(): { value: number; isPositive: boolean } {
    if (this.previousDwellTime === 0) return { value: 0, isPositive: true };
    const change = ((this.avgDwellTime - this.previousDwellTime) / this.previousDwellTime) * 100;
    return { value: Math.abs(change), isPositive: change >= 0 };
  }

  Math = Math;

  // Memoized percentages to avoid recalculating on every change detection
  private _malePercentage?: number;
  private _femalePercentage?: number;
  private _lastDemographicsDataLength = 0;

  getMalePercentage(): number {
    // Recalculate only if demographics data changed
    if (this._malePercentage === undefined || 
        this._lastDemographicsDataLength !== this.demographicsAnalysisChartData.length) {
      if (this.demographicsAnalysisChartData.length === 0) {
        this._malePercentage = 0;
        this._femalePercentage = 0;
      } else {
        // Cache the lookup to avoid multiple find() calls
        let male = 0;
        let female = 0;
        for (const d of this.demographicsAnalysisChartData) {
          if (d.name === 'Male') male = d.value || 0;
          if (d.name === 'Female') female = d.value || 0;
        }
        const total = male + female;
        this._malePercentage = total === 0 ? 0 : Math.round((male / total) * 100);
        this._femalePercentage = total === 0 ? 0 : Math.round((female / total) * 100);
      }
      this._lastDemographicsDataLength = this.demographicsAnalysisChartData.length;
    }
    return this._malePercentage || 0;
  }

  getFemalePercentage(): number {
    // Recalculate only if demographics data changed (calculated together with male percentage)
    if (this._femalePercentage === undefined || 
        this._lastDemographicsDataLength !== this.demographicsAnalysisChartData.length) {
      // Trigger calculation via getMalePercentage which calculates both
      this.getMalePercentage();
    }
    return this._femalePercentage || 0;
  }

  getTotalCrowdPercentage(): number {
    // Total percentage is always 100% (male% + female%)
    return this.getMalePercentage() + this.getFemalePercentage();
  }

  onDateChange(date: Date | null): void {
    if (date) {
      this.selectedDate = date;
      // Reset live occupancy when date changes - will be set correctly in loadDashboardData
      this.liveOccupancy = 0;
      // Update notification service with selected date
      this.notificationService.setSelectedDate(date);
      this.loadDashboardData();
      this.cdr.markForCheck();
    }
  }

  isSelectedDateToday(): boolean {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const selected = new Date(this.selectedDate);
    selected.setHours(0, 0, 0, 0);
    return selected.getTime() === today.getTime();
  }

  getDateDisplayText(): string {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const selected = new Date(this.selectedDate);
    selected.setHours(0, 0, 0, 0);
    
    if (selected.getTime() === today.getTime()) {
      return 'Today';
    }
    
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    if (selected.getTime() === yesterday.getTime()) {
      return 'Yesterday';
    }
    
    return this.selectedDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }
}
