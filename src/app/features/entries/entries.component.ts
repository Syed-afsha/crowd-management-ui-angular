import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { ApiService } from '../../core/services/api.service';
import { SiteService } from '../../core/services/site.service';
import { SocketService } from '../../core/services/socket.service';
import { NotificationService, Alert } from '../../core/services/notification.service';
import { AuthService } from '../../core/services/auth.service';
import { Subscription } from 'rxjs';

@Component({
  standalone: true,
  selector: 'app-entries',
  imports: [
    CommonModule, 
    MatIconModule
  ],
  templateUrl: './entries.component.html',
  styleUrls: ['./entries.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class EntriesComponent implements OnInit, OnDestroy {
  records: any[] = [];
  loading = true;
  currentPage = 1;
  pageSize = 50;
  totalRecords = 0;
  totalPages = 0;
  pageNumbers: (number | string)[] = []; // Expose as property to avoid method calls in template (can include '...' for ellipsis)
  paginationRangeStart = 0;
  paginationRangeEnd = 0;
  
  private subscription?: Subscription;
  private siteChangeSubscription?: Subscription;
  private socketSubscriptions: Subscription[] = [];
  // Cache for computed values
  private _pageNumbersCacheKey?: string;
  private dateTimeCache = new Map<string, string>();

  constructor(
    private api: ApiService,
    private siteService: SiteService,
    private socket: SocketService,
    private notificationService: NotificationService,
    private auth: AuthService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    // Initialize notification service with current site ID for filtering
    const currentSiteId = this.auth.getSiteId();
    if (currentSiteId) {
      this.notificationService.setCurrentSiteId(currentSiteId);
    }
    
    // Setup socket listeners for real-time alerts
    this.setupSocketListeners();
    
    this.loadEntries();
    
    // Listen for site changes and reload entries immediately
    this.siteChangeSubscription = this.siteService.siteChange$.subscribe((siteId: string) => {
      // Update notification service with new site ID for filtering
      this.notificationService.setCurrentSiteId(siteId);
      
      // Immediately show loading state
      this.loading = true;
      this.currentPage = 1; // Reset to first page when site changes
      this.pageNumbers = []; // Reset page numbers
      this._pageNumbersCacheKey = undefined; // Reset cache
      this.cdr.markForCheck();
      // Clear API caches and reload entries
      this.api.clearCaches();
      this.loadEntries();
    });
  }

  ngOnDestroy(): void {
    if (this.subscription) {
      this.subscription.unsubscribe();
    }
    if (this.siteChangeSubscription) {
      this.siteChangeSubscription.unsubscribe();
    }
    // Unsubscribe from socket listeners
    this.socketSubscriptions.forEach(sub => {
      if (sub && !sub.closed) {
        sub.unsubscribe();
      }
    });
    this.socketSubscriptions = [];
    this.dateTimeCache.clear();
  }

  loadEntries(): void {
    // Unsubscribe from any pending requests to prevent race conditions
    if (this.subscription && !this.subscription.closed) {
      this.subscription.unsubscribe();
    }
    
    this.loading = true;
    this.cdr.markForCheck();
    
    this.subscription = this.api.getEntryExit(this.currentPage, this.pageSize).subscribe({
      next: (res) => {
        // Pre-process records to compute all formatting upfront (performance optimization)
        const rawRecords = res.records || res.data || [];
        this.records = rawRecords.map((record: any) => this.preprocessRecord(record));
        
        // Store API total records (backend must provide totalRecords or total)
        const apiTotalRecords = res.totalRecords || res.total || 0;
        this.totalRecords = apiTotalRecords;
        this.totalPages = Math.ceil(this.totalRecords / this.pageSize); // Pagination calculation (UI only)
        
        // Update page numbers and pagination range
        this.updatePageNumbers();
        this.updatePaginationRange();
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: (err) => {
        const errorInfo = {
          type: err.name || 'HTTP Error',
          status: err.status,
          statusText: err.statusText,
          message: err.message,
          error: err.error,
          context: 'entry-exit records',
          page: this.currentPage,
          pageSize: this.pageSize,
          timestamp: new Date().toISOString()
        };
        console.error('❌ Entries: Error loading entries:', errorInfo);
        this.records = [];
        this.loading = false;
        this.cdr.markForCheck();
      }
    });
  }

  goToPage(page: number | string): void {
    if (typeof page !== 'number' || page < 1 || page > this.totalPages) return;
    if (page >= 1 && page <= this.totalPages && page !== this.currentPage) {
      this.currentPage = page;
      // Reset page numbers cache to force recalculation
      this._pageNumbersCacheKey = undefined;
      this.updatePageNumbers();
      this.loadEntries();
    }
  }

  previousPage(): void {
    if (this.currentPage > 1) {
      this.currentPage--;
      // Reset page numbers cache to force recalculation
      this._pageNumbersCacheKey = undefined;
      this.updatePageNumbers();
      this.loadEntries();
    }
  }

  nextPage(): void {
    if (this.currentPage < this.totalPages) {
      this.currentPage++;
      // Reset page numbers cache to force recalculation
      this._pageNumbersCacheKey = undefined;
      this.updatePageNumbers();
      this.loadEntries();
    }
  }
  
  private updatePaginationRange(): void {
    this.paginationRangeStart = (this.currentPage - 1) * this.pageSize + 1;
    this.paginationRangeEnd = Math.min(this.currentPage * this.pageSize, this.totalRecords);
  }

  private updatePageNumbers(): void {
    // Memoize page numbers calculation
    const cacheKey = `${this.currentPage}-${this.totalPages}`;
    if (this.pageNumbers.length > 0 && this._pageNumbersCacheKey === cacheKey) {
      return;
    }

    // Calculate page numbers to show with ellipsis (matching Figma: "< 1 2 3 ... 5 >")
    const pages: (number | string)[] = [];
    
    if (this.totalPages <= 7) {
      // Show all pages if 7 or fewer
      for (let i = 1; i <= this.totalPages; i++) {
        pages.push(i);
      }
    } else {
      // Always show first page
      pages.push(1);
      
      if (this.currentPage <= 3) {
        // Show: 1 2 3 ... last
        for (let i = 2; i <= 3; i++) {
          pages.push(i);
        }
        pages.push('...');
        pages.push(this.totalPages);
      } else if (this.currentPage >= this.totalPages - 2) {
        // Show: 1 ... second-to-last last
        pages.push('...');
        for (let i = this.totalPages - 2; i <= this.totalPages; i++) {
      pages.push(i);
        }
      } else {
        // Show: 1 ... current-1 current current+1 ... last
        pages.push('...');
        pages.push(this.currentPage - 1);
        pages.push(this.currentPage);
        pages.push(this.currentPage + 1);
        pages.push('...');
        pages.push(this.totalPages);
      }
    }
    
    this.pageNumbers = pages;
    this._pageNumbersCacheKey = cacheKey;
  }

  formatDateTime(dateTime: string | number | null | undefined): string {
    if (!dateTime || dateTime === null || dateTime === undefined) return '-';
    
    const cacheKey = String(dateTime);
    const cached = this.dateTimeCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      // API provides entryLocal/exitLocal as "DD/MM/YYYY HH:mm:ss" format
      // Parse this format directly for better performance
      let date: Date;
      if (typeof dateTime === 'string' && dateTime.includes('/')) {
        // Parse "DD/MM/YYYY HH:mm:ss" format
        const parts = dateTime.match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/);
        if (parts) {
          const [, day, month, year, hour, minute] = parts;
          date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day), parseInt(hour), parseInt(minute));
        } else {
          date = new Date(dateTime);
        }
      } else {
        date = new Date(typeof dateTime === 'string' ? dateTime : dateTime);
      }
      
      if (isNaN(date.getTime())) {
        const result = '-';
        this.dateTimeCache.set(cacheKey, result);
        return result;
      }
      // Format as "11:05 AM" to match design
      const result = date.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      });
      this.dateTimeCache.set(cacheKey, result);
      return result;
    } catch (err) {
      const result = '-';
      this.dateTimeCache.set(cacheKey, result);
      return result;
    }
  }

  formatDwellTime(dwellTime: number | string | null | undefined): string {
    if (dwellTime === null || dwellTime === undefined || dwellTime === '') return '-';
    const dwell = typeof dwellTime === 'string' ? parseFloat(dwellTime) : dwellTime;
    if (isNaN(dwell) || dwell === 0) return '-';
    // Format as "00:20" (HH:MM) to match design
    const hours = Math.floor(dwell / 60);
    const minutes = Math.round(dwell % 60);
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
  }

  private preprocessRecord(record: any): any {
    const personName = record.personName || 'N/A';
    const gender = record.gender || 'N/A';
    const isActive = !record.exitUtc && !record.exitLocal; // Active if no exit time
    
    // Pre-compute formatted dates (backend provides entryLocal/exitLocal as strings)
    const entryDateTime = this.formatDateTime(record.entryLocal || record.entryUtc);
    const exitDateTime = isActive ? '--' : this.formatDateTime(record.exitLocal || record.exitUtc);
    
    // Pre-compute dwell time (backend provides dwellMinutes as number or null)
    const dwellTime = isActive ? '--' : this.formatDwellTime(record.dwellMinutes);
    
    // Pre-compute avatar URL
    const seed = record.personId 
      ? (record.personId.charCodeAt(0) % 10) + 1
      : (personName.charCodeAt(0) % 10) + 1;
    const avatarUrl = `https://i.pravatar.cc/150?img=${seed}`;
    
    // Return new object with pre-computed values
    return {
      ...record,
      // Pre-computed display values
      _displayName: personName,
      _displayGender: gender,
      _isActive: isActive,
      _entryDateTime: entryDateTime,
      _exitDateTime: exitDateTime,
      _dwellTime: dwellTime,
      _avatarUrl: avatarUrl,
      // Keep original values for tracking
      _personId: record.personId || record.id
    };
  }

  trackByRecordId(index: number, record: any): string {
    // Use pre-computed person ID or fallback to index
    return record._personId || record.personId || record.id || index.toString();
  }

  trackByPageNumber(index: number, page: number | string): number | string {
    return page;
  }

  onImageError(event: Event): void {
    // Fallback to default avatar if image fails to load
    const img = event.target as HTMLImageElement;
    if (img) {
      img.src = 'https://i.pravatar.cc/150?img=1';
    }
  }

  private setupSocketListeners(): void {
    // Listen for alert events and process them
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
        console.error('❌ Entries: Socket subscription error (alert):', errorInfo);
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
    // Get siteId if available for filtering
    const siteId = alertData.siteId || alertData.site || null;

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
      siteId: siteId || undefined,
      severity,
      timestamp,
      message: message,
      raw: alertData
    };

    // Backend handles all filtering (by date, site, etc.)
    // Just add all alerts that backend sends us
    this.notificationService.addAlert(alert);
  }
}
