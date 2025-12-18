import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatButtonModule } from '@angular/material/button';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ApiService } from '../../core/services/api.service';
import { SocketService } from '../../core/services/socket.service';
import { SiteService } from '../../core/services/site.service';
import { NotificationService, Alert } from '../../core/services/notification.service';
import { AuthService } from '../../core/services/auth.service';
import { NgxChartsModule } from '@swimlane/ngx-charts';
import { Subscription, debounceTime, distinctUntilChanged, catchError, of, Subject, switchMap } from 'rxjs';
import { curveCardinal } from 'd3-shape';

@Component({
  standalone: true,
  selector: 'app-dashboard',
  imports: [CommonModule, NgxChartsModule, MatIconModule, MatDatepickerModule, MatNativeDateModule, MatButtonModule, MatInputModule, MatFormFieldModule, MatProgressSpinnerModule],
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
  dwellRecords = 0; // Backend provides this

  previousFootfall = 0;
  previousDwellTime = 0;
  previousLiveOccupancy = 0;
  
  // Percentage change calculations
  liveOccupancyChange: { value: number; isPositive: boolean } | null = null;
  footfallChange: { value: number; isPositive: boolean } | null = null;
  dwellTimeChange: { value: number; isPositive: boolean } | null = null;
  
  occupancyChartData: any[] = [];
  demographicsChartData: any[] = [];
  demographicsAnalysisChartData: any[] = [];
  
  // Timezone information from backend
  siteTimezone: string = '';
  
  // Demographics totals for display
  totalMaleCount = 0;
  totalFemaleCount = 0;
  
  // Live marker properties
  liveMarkerPosition: number | null = null; // Percentage position (0-100)
  occupancyTimeRange: { fromUtc: number; toUtc: number } | null = null;
  private liveMarkerUpdateInterval?: any;
  
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
    view: [800, 300] as [number, number], // Default view size - will be responsive
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
    view: [600, 300] as [number, number], // Default view size
    animations: false
  };
  pieChartOptions = {
    showLegend: true,
    view: [340, 240] as [number, number], // Slightly increased size
    animations: false // Explicitly disable animations
  };

  curve = curveCardinal.tension(0.5); // Smooth wavy curves

  selectedDate: Date = (() => {
    // Normalize initial date to midnight UTC
    const today = new Date();
    return new Date(Date.UTC(
      today.getUTCFullYear(),
      today.getUTCMonth(),
      today.getUTCDate(),
      0, 0, 0, 0
    ));
  })();
  
  // Pre-computed display values (performance optimization)
  dateDisplayText = '';
  footfallDisplayValue = '';
  dwellTimeDisplayValue = '';
  totalCrowdPercentage = 0;
  malePercentage = 0;
  femalePercentage = 0;

  private socketSubscriptions: Subscription[] = [];
  private httpSubscriptions: Subscription[] = [];
  private siteChangeSubscription?: Subscription;
  private footfallRefreshPending = false;
  
  // OPTIMIZATION: Use RxJS Subject for better footfall refresh debouncing
  private footfallRefreshTrigger$ = new Subject<void>();
  private footfallRefreshSubscription?: Subscription;
  
  // Window resize handler reference for cleanup
  private resizeHandler = () => this.updateChartViewDimensions();

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
    
    // Calculate responsive chart view dimensions
    this.updateChartViewDimensions();
    
    // Set up site change listener (separate from HTTP subscriptions to prevent accidental unsubscription)
    this.siteChangeSubscription = this.siteService.siteChange$.subscribe(() => {
      // Clear caches and reload data when site changes
      this.api.clearCaches();
      // Reset comparison data
      this.liveOccupancyChange = null;
      this.footfallChange = null;
      this.dwellTimeChange = null;
      this.previousFootfall = 0;
      this.previousDwellTime = 0;
      this.previousLiveOccupancy = 0;
      this.updateDateDisplayText();
      this.loadDashboardData();
    });
    
    // Load data immediately if site already exists (for navigation back to dashboard)
    // Otherwise wait for siteChange$ to emit (initial load after login)
    if (this.auth.getSiteId()) {
        this.loadDashboardData();
      }
    // If no site exists, we wait for siteChange$ to emit (handled by layout component)
    
    this.setupSocketListeners();
    this.setupFootfallRefresh();
    
    // Update chart dimensions on window resize
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', this.resizeHandler);
    }
    
    // Start live marker updates if viewing today
    if (this.isSelectedDateToday()) {
      this.startLiveMarkerUpdates();
    }
  }
  
  /**
   * OPTIMIZATION: Setup optimized footfall refresh using RxJS operators
   * Replaces setTimeout-based debouncing with proper RxJS debounceTime and switchMap
   */
  private setupFootfallRefresh(): void {
    this.footfallRefreshSubscription = this.footfallRefreshTrigger$.pipe(
      debounceTime(3000), // Debounce for 3 seconds
      switchMap(() => {
        // Cancel previous request if new one comes in
        return this.api.getFootfall().pipe(
          catchError(err => {
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
            return of(null);
          })
        );
      })
    ).subscribe({
      next: (res) => {
        if (res) {
          // Backend provides: { siteId, fromUtc, toUtc, footfall }
          this.todaysFootfall = res.footfall ?? 0;
          this.footfallDisplayValue = this.todaysFootfall.toLocaleString();
          this.updateDateDisplayText();
          // Reload yesterday's comparison
          const now = Date.now();
          const dayDiff = 24 * 60 * 60 * 1000;
          const yesterdayFromUtc = Date.UTC(new Date(now - dayDiff).getUTCFullYear(), new Date(now - dayDiff).getUTCMonth(), new Date(now - dayDiff).getUTCDate(), 8, 0, 0, 0);
          const yesterdayToUtc = now - dayDiff;
          if (yesterdayToUtc > yesterdayFromUtc) {
            const footfallSub = this.api.getFootfall(yesterdayFromUtc, yesterdayToUtc).subscribe({
              next: (yesterdayRes) => {
                if (yesterdayRes) {
                  this.previousFootfall = yesterdayRes.footfall ?? 0;
                  this.calculateFootfallChange();
                }
              }
            });
            this.httpSubscriptions.push(footfallSub);
          }
          this.cdr.markForCheck();
        }
        this.footfallRefreshPending = false;
      },
      error: () => {
        this.footfallRefreshPending = false;
      }
    });
  }

  ngOnDestroy(): void {
    this.socketSubscriptions.forEach(sub => sub.unsubscribe());
    this.socketSubscriptions = [];
    
    // Remove window resize listener
    if (typeof window !== 'undefined') {
      window.removeEventListener('resize', this.resizeHandler);
    }
    this.httpSubscriptions.forEach(sub => sub.unsubscribe());
    this.httpSubscriptions = [];
    if (this.siteChangeSubscription) {
      this.siteChangeSubscription.unsubscribe();
    }
    if (this.footfallRefreshSubscription) {
      this.footfallRefreshSubscription.unsubscribe();
    }
    // Complete the subject to prevent memory leaks
    this.footfallRefreshTrigger$.complete();
    
    // Stop live marker updates
    this.stopLiveMarkerUpdates();
  }

  private loadDashboardData(): void {
    // Unsubscribe from any pending HTTP requests to prevent race conditions
    this.httpSubscriptions.forEach(sub => {
      if (sub && !sub.closed) {
        sub.unsubscribe();
      }
    });
    this.httpSubscriptions = [];
    
    // Set loading flags for individual sections
    // Don't reset chart data here - let it update when new data arrives to avoid flicker
    this.loadingFootfall = true;
    this.loadingDwell = true;
    this.loadingOccupancy = true;
    this.loadingDemographics = true;
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
    
    // Date range calculation - logging removed to reduce console noise
    
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
    
    
    // PHASE 1: High Priority - Summary Cards (Footfall & Dwell)
    // OPTIMIZED: Use batch API method for parallel loading with shared payload
    // These APIs power summary cards and must load first
    const phase1Sub = this.api.getSummaryCardsBatch(fromUtc, toUtc).subscribe({
      next: (phase1Results) => {
        // Reset comparison data when loading new site data
        this.previousFootfall = 0;
        this.previousDwellTime = 0;
        this.footfallChange = null;
        this.dwellTimeChange = null;
        
        // Process footfall - Use backend data directly
        // Backend provides: { siteId, fromUtc, toUtc, footfall }
        if (phase1Results.footfall) {
          // Footfall data processed - API provides: { siteId, fromUtc, toUtc, footfall }
          this.todaysFootfall = phase1Results.footfall.footfall ?? 0;
          this.footfallDisplayValue = this.todaysFootfall.toLocaleString();
          this.updateDateDisplayText();
        } else {
          this.todaysFootfall = 0;
          this.footfallDisplayValue = '0';
        }
        this.loadingFootfall = false;
        
        // Process dwell - Use backend data directly (API: { siteId, fromUtc, toUtc, avgDwellMinutes, dwellRecords })
        if (phase1Results.dwell) {
          // API always provides 'avgDwellMinutes' and 'dwellRecords' fields
          this.avgDwellTime = phase1Results.dwell.avgDwellMinutes ?? 0;
          this.dwellRecords = phase1Results.dwell.dwellRecords ?? 0;
          
          // Format display value: "23min 8sec" format
          const minutes = Math.floor(this.avgDwellTime);
          const seconds = Math.round((this.avgDwellTime % 1) * 60);
          this.dwellTimeDisplayValue = `${minutes}min ${seconds}sec`;
        } else {
          this.avgDwellTime = 0;
          this.dwellRecords = 0;
          this.dwellTimeDisplayValue = '0min 0sec';
        }
        this.loadingDwell = false;
        
        // Load yesterday's data for comparison AFTER today's data is set
        // This ensures calculations use the correct current values
        this.loadYesterdayComparison(fromUtc, toUtc);
        
        // Phase 1 complete - trigger change detection for summary cards
        this.checkAllLoaded();
        this.cdr.markForCheck();
        
        // PHASE 2: Low Priority - Charts (Occupancy & Demographics)
        // OPTIMIZED: Use batch API method for parallel loading with shared payload
        // These are heavy APIs and load in background after Phase 1 completes
        // Must NOT block summary cards
        const phase2Sub = this.api.getChartsBatch(fromUtc, toUtc).subscribe({
          next: (batchResults) => {
            // Process occupancy from batch results
            if (batchResults.occupancy) {
              this.processOccupancyData(batchResults.occupancy);
              // Extract timezone from API response
              if (!this.siteTimezone && batchResults.occupancy.timezone) {
                this.siteTimezone = batchResults.occupancy.timezone;
              }
              // Reset comparison data when loading new occupancy data
              this.previousLiveOccupancy = 0;
              this.liveOccupancyChange = null;
              
              // Backend doesn't provide liveOccupancy - use latest bucket for today
              if (this.isSelectedDateToday() && batchResults.occupancy.buckets?.length > 0) {
                const latestBucket = batchResults.occupancy.buckets[batchResults.occupancy.buckets.length - 1];
                this.liveOccupancy = Number(latestBucket.avg) || 0;
              } else {
                this.liveOccupancy = 0;
              }
              
              // Load yesterday's occupancy for comparison AFTER current value is set
              this.loadYesterdayOccupancy(fromUtc, toUtc);
            } else {
              // Clear data on error/null to show "no data available"
              this.occupancyChartData = [];
              this.liveOccupancy = 0;
            }
            this.loadingOccupancy = false;
            
            // Process demographics from batch results
            if (batchResults.demographics) {
              this.processDemographicsData(batchResults.demographics);
              this.processDemographicsAnalysisData(batchResults.demographics);
              // Extract timezone from API response
              if (!this.siteTimezone && batchResults.demographics.timezone) {
                this.siteTimezone = batchResults.demographics.timezone;
              }
            } else {
              // Clear data on error/null to show "no data available"
              this.demographicsChartData = [];
              this.demographicsAnalysisChartData = [];
              this.updateDemographicsPercentages(); // Reset percentages
            }
            this.loadingDemographics = false;
            
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
            // Reset chart data on error to show "no data available"
            this.occupancyChartData = [];
            this.demographicsChartData = [];
            this.demographicsAnalysisChartData = [];
            this.updateDemographicsPercentages(); // Reset percentages
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
        // OPTIMIZED: Use batch API method for parallel loading with shared payload
        const phase2Sub = this.api.getChartsBatch(fromUtc, toUtc).subscribe({
          next: (batchResults) => {
            if (batchResults.occupancy) {
              this.processOccupancyData(batchResults.occupancy);
            } else {
              // Clear data on error/null to show "no data available"
              this.occupancyChartData = [];
              this.liveOccupancy = 0;
            }
            this.loadingOccupancy = false;
            
            if (batchResults.demographics) {
              this.processDemographicsData(batchResults.demographics);
              this.processDemographicsAnalysisData(batchResults.demographics);
            } else {
              // Clear data on error/null to show "no data available"
              this.demographicsChartData = [];
              this.demographicsAnalysisChartData = [];
              this.updateDemographicsPercentages(); // Reset percentages
            }
            this.loadingDemographics = false;
            this.checkAllLoaded();
            this.cdr.markForCheck();
          },
          error: () => {
            // Reset chart data on error to show "no data available"
            this.occupancyChartData = [];
            this.demographicsChartData = [];
            this.demographicsAnalysisChartData = [];
            this.updateDemographicsPercentages(); // Reset percentages
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
    // Occupancy data processed - API provides: { siteId, fromUtc, toUtc, timezone, buckets: [{ utc, local, avg }] }
    
    // Store time range for live marker calculation
    if (data?.fromUtc && data?.toUtc) {
      this.occupancyTimeRange = {
        fromUtc: data.fromUtc,
        toUtc: data.toUtc
      };
    } else {
      this.occupancyTimeRange = null;
    }
    
    // Backend provides buckets array with: { utc, local, avg }
    // local format: "18/12/2025 12:00:00" -> extract "12:00"
    const buckets = data?.buckets || [];
    
    if (buckets.length === 0) {
      this.occupancyChartData = [];
      this.liveMarkerPosition = null;
      this.cdr.markForCheck();
      return;
    }
    
    // Optimized: Direct extraction from known API structure
    const series = buckets.map((item: any) => {
      // Extract time from local field: "18/12/2025 12:00:00" -> "12:00"
      let timeLabel = '';
      if (item.local && typeof item.local === 'string') {
        // Format: "DD/MM/YYYY HH:mm:ss" -> extract "HH:mm"
        const timeMatch = item.local.match(/(\d{2}:\d{2}):\d{2}/);
        timeLabel = timeMatch ? timeMatch[1] : item.local;
      } else if (item.utc) {
        // Fallback: format UTC timestamp
        timeLabel = this.formatTime(item.utc);
      }
      
      return {
        name: timeLabel || String(item.utc || ''),
        value: Number(item.avg) || 0
      };
    });
    
    this.occupancyChartData = [{
      name: 'Occupancy',
      series: series
    }];
    
    // Calculate and start updating live marker position
    this.calculateLiveMarkerPosition();
    this.startLiveMarkerUpdates();
    
    this.cdr.markForCheck();
  }

  private processDemographicsData(data: any): void {
    // Backend API structure: { siteId, fromUtc, toUtc, timezone, buckets: [{ utc, local, male, female }] }
    // local format: "18/12/2025 12:00:00" -> extract "12:00"
    const buckets = data?.buckets || [];
    
    if (buckets.length === 0) {
      this.demographicsChartData = [];
      this.cdr.markForCheck();
      return;
    }
    
    // Optimized: Direct field access from verified API structure
    // Extract time once and reuse for both series (performance optimization)
    const extractTime = (item: any): string => {
      // Extract "HH:mm" from "DD/MM/YYYY HH:mm:ss" format (API always provides local)
      const timeMatch = item.local?.match(/(\d{2}:\d{2}):\d{2}/);
      return timeMatch ? timeMatch[1] : (item.local || String(item.utc || ''));
    };
    
    const maleSeries = buckets.map((item: any) => ({
      name: extractTime(item),
      value: Number(item.male) || 0  // API always provides 'male' field
    }));
    
    const femaleSeries = buckets.map((item: any) => ({
      name: extractTime(item),
      value: Number(item.female) || 0  // API always provides 'female' field
    }));
    
    this.demographicsChartData = [
      { name: 'Male', series: maleSeries },
      { name: 'Female', series: femaleSeries }
    ];
    this.cdr.markForCheck();
  }

  private processDemographicsAnalysisData(data: any): void {
    // Backend API structure: { siteId, fromUtc, toUtc, timezone, buckets: [{ utc, local, male, female }] }
    // Aggregate totals from buckets (backend doesn't provide pre-calculated totals)
    const buckets = data?.buckets || [];
    
    // Optimized: Direct aggregation from verified API structure
    let totalMale = 0;
    let totalFemale = 0;
    
    for (const item of buckets) {
      totalMale += Number(item.male) || 0;    // API always provides 'male' field
      totalFemale += Number(item.female) || 0; // API always provides 'female' field
    }
    
    // Store totals for display
    this.totalMaleCount = totalMale;
    this.totalFemaleCount = totalFemale;
    
    this.demographicsAnalysisChartData = [
      { name: 'Male', value: totalMale },
      { name: 'Female', value: totalFemale }
    ];
    
    // Calculate percentages from aggregated totals (minimal calculation for display)
    this.updateDemographicsPercentages();
    this.cdr.markForCheck();
  }

  /**
   * Format UTC timestamp to time string (HH:mm format)
   * Used as fallback when local field is not available
   */
  private formatTime(timestamp: number | string): string {
    if (!timestamp && timestamp !== 0) return '';
    
    try {
      const date = typeof timestamp === 'number' 
        ? (timestamp < 10000000000 ? new Date(timestamp * 1000) : new Date(timestamp))
        : new Date(timestamp);
      
      if (isNaN(date.getTime())) return '';
      
      return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    } catch {
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
        // Backend should provide rounded occupancy value - use it directly
        if (!isNaN(occupancyValue) && occupancyValue >= 0 && this.isSelectedDateToday()) {
          this.liveOccupancy = occupancyValue; // Backend should provide rounded value
          this.calculateLiveOccupancyChange();
          this.cdr.markForCheck();
        } else if (!this.isSelectedDateToday()) {
          // Ensure live occupancy is 0 for past/future dates
          this.liveOccupancy = 0;
          this.liveOccupancyChange = null;
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

    // OPTIMIZATION: Use RxJS Subject for better debouncing and request cancellation
    // Debounce footfall refresh to prevent excessive API calls
    if (actionType === 'entry' || actionType === 'exit') {
      if (!this.footfallRefreshPending) {
        this.footfallRefreshPending = true;
        // Trigger the debounced refresh
        this.footfallRefreshTrigger$.next();
      }
    }
  }


  /**
   * Load yesterday's data for comparison calculations
   */
  private loadYesterdayComparison(fromUtc: number, toUtc: number): void {
    // Calculate yesterday's date range (same time period, but yesterday)
    const dayDiff = 24 * 60 * 60 * 1000; // 1 day in milliseconds
    const yesterdayFromUtc = fromUtc - dayDiff;
    const yesterdayToUtc = toUtc - dayDiff;
    
    // Store current site ID to verify we're still on the same site when response arrives
    const currentSiteId = this.auth.getSiteId();
    
    // Fetch yesterday's footfall
    const footfallSub = this.api.getFootfall(yesterdayFromUtc, yesterdayToUtc).subscribe({
      next: (res) => {
        // Verify we're still on the same site (prevent race conditions)
        if (this.auth.getSiteId() !== currentSiteId) {
          return; // Site changed, ignore this response
        }
        
        if (res && res.footfall !== undefined && res.footfall !== null) {
          this.previousFootfall = res.footfall;
          // Recalculate with current values (in case they changed)
          this.calculateFootfallChange();
        } else {
          // No data for yesterday - hide percentage
          this.previousFootfall = 0;
          this.footfallChange = null;
        }
        this.cdr.markForCheck();
      },
      error: () => {
        // Only update if still on same site
        if (this.auth.getSiteId() === currentSiteId) {
          this.previousFootfall = 0;
          this.footfallChange = null;
          this.cdr.markForCheck();
        }
      }
    });
    
    // Fetch yesterday's dwell time
    const dwellSub = this.api.getDwell(yesterdayFromUtc, yesterdayToUtc).subscribe({
      next: (res) => {
        // Verify we're still on the same site (prevent race conditions)
        if (this.auth.getSiteId() !== currentSiteId) {
          return; // Site changed, ignore this response
        }
        
        if (res && res.avgDwellMinutes !== undefined && res.avgDwellMinutes !== null) {
          this.previousDwellTime = res.avgDwellMinutes;
          // Recalculate with current values (in case they changed)
          this.calculateDwellTimeChange();
        } else {
          // No data for yesterday - hide percentage
          this.previousDwellTime = 0;
          this.dwellTimeChange = null;
        }
        this.cdr.markForCheck();
      },
      error: () => {
        // Only update if still on same site
        if (this.auth.getSiteId() === currentSiteId) {
          this.previousDwellTime = 0;
          this.dwellTimeChange = null;
          this.cdr.markForCheck();
        }
      }
    });
    
    this.httpSubscriptions.push(footfallSub, dwellSub);
  }
  
  /**
   * Load yesterday's occupancy for live occupancy comparison
   */
  private loadYesterdayOccupancy(fromUtc: number, toUtc: number): void {
    // For live occupancy, compare current value to same time yesterday
    const now = Date.now();
    const dayDiff = 24 * 60 * 60 * 1000;
    const yesterdaySameTime = now - dayDiff;
    
    // Calculate yesterday's date range
    const yesterdayFromUtc = fromUtc - dayDiff;
    const yesterdayToUtc = yesterdaySameTime; // Up to same time yesterday
    
    // Store current site ID to verify we're still on the same site when response arrives
    const currentSiteId = this.auth.getSiteId();
    
    // Only fetch if we have a valid range
    if (yesterdayToUtc > yesterdayFromUtc) {
      const occupancySub = this.api.getOccupancy(yesterdayFromUtc, yesterdayToUtc).subscribe({
        next: (res) => {
          // Verify we're still on the same site (prevent race conditions)
          if (this.auth.getSiteId() !== currentSiteId) {
            return; // Site changed, ignore this response
          }
          
          if (res && res.buckets && res.buckets.length > 0) {
            // Get the bucket closest to the same time yesterday
            const latestBucket = res.buckets[res.buckets.length - 1];
            this.previousLiveOccupancy = Number(latestBucket.avg) || 0;
            // Recalculate with current value (in case it changed)
            this.calculateLiveOccupancyChange();
          } else {
            this.previousLiveOccupancy = 0;
            this.liveOccupancyChange = null;
            this.cdr.markForCheck();
          }
        },
        error: () => {
          // Only update if still on same site
          if (this.auth.getSiteId() === currentSiteId) {
            this.previousLiveOccupancy = 0;
            this.liveOccupancyChange = null;
            this.cdr.markForCheck();
          }
        }
      });
      
      this.httpSubscriptions.push(occupancySub);
    } else {
      this.previousLiveOccupancy = 0;
      this.liveOccupancyChange = null;
    }
  }
  
  /**
   * Calculate percentage change for live occupancy
   */
  private calculateLiveOccupancyChange(): void {
    // Only calculate if we have valid previous data (need a baseline to compare against)
    if (this.previousLiveOccupancy === 0 || this.previousLiveOccupancy === null || this.previousLiveOccupancy === undefined) {
      this.liveOccupancyChange = null;
      return;
    }
    
    // Calculate percentage change (always show, even if 0%)
    const change = ((this.liveOccupancy - this.previousLiveOccupancy) / this.previousLiveOccupancy) * 100;
    const changeValue = Math.abs(change);
    
    this.liveOccupancyChange = {
      value: changeValue,
      isPositive: change >= 0
    };
    this.cdr.markForCheck();
  }
  
  /**
   * Calculate percentage change for footfall
   */
  private calculateFootfallChange(): void {
    // Only calculate if we have valid previous data (need a baseline to compare against)
    if (this.previousFootfall === 0 || this.previousFootfall === null || this.previousFootfall === undefined) {
      this.footfallChange = null;
      return;
    }
    
    // Calculate percentage change (always show, even if 0%)
    const change = ((this.todaysFootfall - this.previousFootfall) / this.previousFootfall) * 100;
    const changeValue = Math.abs(change);
    
    this.footfallChange = {
      value: changeValue,
      isPositive: change >= 0
    };
    this.cdr.markForCheck();
  }
  
  /**
   * Calculate percentage change for dwell time
   */
  private calculateDwellTimeChange(): void {
    // Only calculate if we have valid previous data (need a baseline to compare against)
    if (this.previousDwellTime === 0 || this.previousDwellTime === null || this.previousDwellTime === undefined) {
      this.dwellTimeChange = null;
      return;
    }
    
    // Calculate percentage change (always show, even if 0%)
    const change = ((this.avgDwellTime - this.previousDwellTime) / this.previousDwellTime) * 100;
    const changeValue = Math.abs(change);
    
    this.dwellTimeChange = {
      value: changeValue,
      isPositive: change >= 0
    };
    this.cdr.markForCheck();
  }

  onDateChange(date: Date | null): void {
    if (date) {
      // Normalize date to remove time component - we only care about the date
      // Use UTC methods to ensure consistent date normalization regardless of timezone
      const normalizedDate = new Date(Date.UTC(
        date.getUTCFullYear(),
        date.getUTCMonth(),
        date.getUTCDate(),
        0, 0, 0, 0
      ));
      this.selectedDate = normalizedDate;
      
      // Reset live occupancy when date changes - will be set correctly in loadDashboardData
      this.liveOccupancy = 0;
      // Update date display text immediately
      this.updateDateDisplayText();
      // Reset comparison data
      this.liveOccupancyChange = null;
      this.footfallChange = null;
      this.dwellTimeChange = null;
      this.previousFootfall = 0;
      this.previousDwellTime = 0;
      this.previousLiveOccupancy = 0;
      // Update notification service with selected date
      this.notificationService.setSelectedDate(normalizedDate);
      // Date change logged only for debugging - removed to reduce console noise
      
      // Recalculate live marker for new date
      this.calculateLiveMarkerPosition();
      if (this.isSelectedDateToday()) {
        this.startLiveMarkerUpdates();
      } else {
        this.stopLiveMarkerUpdates();
      }
      
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

  private updateChartViewDimensions(): void {
    if (typeof window === 'undefined') return;
    
    // Calculate responsive dimensions based on container width
    // Account for padding (24px * 2 = 48px) and gap (20px)
    const containerWidth = window.innerWidth - 60; // Account for dashboard padding (30px * 2)
    const chartSectionWidth = containerWidth - 48; // Account for chart-section padding
    
    // Overall Occupancy chart: full width minus padding
    this.chartOptions.view = [Math.max(600, chartSectionWidth), 300] as [number, number];
    
    // Demographics Analysis chart: 2/3 of grid width (2fr out of 1fr + 2fr = 3fr total)
    // Account for card padding (24px * 2 = 48px) and gap (20px)
    const demographicsGridWidth = containerWidth - 20; // Account for grid gap
    const demographicsCardWidth = (demographicsGridWidth * 2 / 3) - 48; // 2fr out of 3fr, minus card padding
    this.demographicsChartOptions.view = [Math.max(400, demographicsCardWidth), 300] as [number, number];
    
    // Pie chart: 1/3 of grid width, maintain square aspect ratio
    const pieCardWidth = (demographicsGridWidth * 1 / 3) - 48; // 1fr out of 3fr, minus card padding
    const pieSize = Math.min(Math.max(280, pieCardWidth), 240); // Square chart, max 240px to fit container height
    this.pieChartOptions.view = [pieSize, pieSize] as [number, number];
    
    this.cdr.markForCheck();
  }

  private updateDateDisplayText(): void {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const selected = new Date(this.selectedDate);
    selected.setHours(0, 0, 0, 0);
    
    if (selected.getTime() === today.getTime()) {
      this.dateDisplayText = 'Today';
    } else {
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    if (selected.getTime() === yesterday.getTime()) {
        this.dateDisplayText = 'Yesterday';
      } else {
        this.dateDisplayText = this.selectedDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }
    }
  }

  private calculateLiveMarkerPosition(): void {
    // Only show live marker if:
    // 1. We have occupancy data
    // 2. Selected date is today
    // 3. We have a valid time range
    if (!this.occupancyTimeRange || !this.isSelectedDateToday() || this.occupancyChartData.length === 0) {
      this.liveMarkerPosition = null;
      this.cdr.markForCheck();
      return;
    }

    const now = Date.now();
    const { fromUtc, toUtc } = this.occupancyTimeRange;
    
    // Calculate position as percentage (0-100)
    if (now >= fromUtc && now <= toUtc) {
      // Current time is within the chart range
      const position = ((now - fromUtc) / (toUtc - fromUtc)) * 100;
      this.liveMarkerPosition = Math.min(100, Math.max(0, position));
    } else if (now > toUtc) {
      // Current time is beyond the chart range - show at the end
      this.liveMarkerPosition = 100;
    } else {
      // Current time is before the chart range - don't show
      this.liveMarkerPosition = null;
    }
    
    this.cdr.markForCheck();
  }

  private startLiveMarkerUpdates(): void {
    // Clear any existing interval
    this.stopLiveMarkerUpdates();
    
    // Update immediately
    this.calculateLiveMarkerPosition();
    
    // Update every 30 seconds to keep marker current
    this.liveMarkerUpdateInterval = setInterval(() => {
      this.calculateLiveMarkerPosition();
    }, 30000);
  }

  private stopLiveMarkerUpdates(): void {
    if (this.liveMarkerUpdateInterval) {
      clearInterval(this.liveMarkerUpdateInterval);
      this.liveMarkerUpdateInterval = undefined;
    }
  }

  private updateDemographicsPercentages(): void {
    // Calculate percentages from pie chart data (backend doesn't provide pre-calculated percentages)
    if (this.demographicsAnalysisChartData.length === 0) {
      this.malePercentage = 0;
      this.femalePercentage = 0;
      this.totalCrowdPercentage = 0;
      return;
    }
    
    let male = 0;
    let female = 0;
    for (const d of this.demographicsAnalysisChartData) {
      if (d.name === 'Male') male = d.value || 0;
      if (d.name === 'Female') female = d.value || 0;
    }
    
    const total = male + female;
    this.malePercentage = total === 0 ? 0 : Math.round((male / total) * 100);
    this.femalePercentage = total === 0 ? 0 : Math.round((female / total) * 100);
    this.totalCrowdPercentage = this.malePercentage + this.femalePercentage;
  }

}
