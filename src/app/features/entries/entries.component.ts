import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { ApiService } from '../../core/services/api.service';
import { SiteService } from '../../core/services/site.service';
import { Subscription } from 'rxjs';

@Component({
  standalone: true,
  selector: 'app-entries',
  imports: [CommonModule, MatIconModule],
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
  private subscription?: Subscription;
  private siteChangeSubscription?: Subscription;
  // Cache for computed values
  private _pageNumbersCacheKey?: string;
  private dateTimeCache = new Map<string, string>();

  constructor(
    private api: ApiService,
    private siteService: SiteService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.loadEntries();
    
    // Listen for site changes and reload entries immediately
    this.siteChangeSubscription = this.siteService.siteChange$.subscribe(() => {
      // Immediately show loading state
      this.loading = true;
      this.currentPage = 1; // Reset to first page when site changes
      this.cdr.markForCheck();
      // Reload entries (cache is already cleared by SiteService)
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
        this.records = res.records || res.data || [];
        this.totalRecords = res.totalRecords || res.total || this.records.length;
        this.totalPages = Math.ceil(this.totalRecords / this.pageSize);
        // Update page numbers
        this.updatePageNumbers();
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: (err) => {
        console.error('Error loading entries:', err);
        this.records = [];
        this.loading = false;
        this.cdr.markForCheck();
      }
    });
  }

  goToPage(page: number | string): void {
    if (typeof page !== 'number' || page < 1 || page > this.totalPages) return;
    if (page >= 1 && page <= this.totalPages) {
      this.currentPage = page;
      this.updatePageNumbers();
      this.loadEntries();
    }
  }

  previousPage(): void {
    if (this.currentPage > 1) {
      this.currentPage--;
      this.updatePageNumbers();
      this.loadEntries();
    }
  }

  nextPage(): void {
    if (this.currentPage < this.totalPages) {
      this.currentPage++;
      this.updatePageNumbers();
      this.loadEntries();
    }
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
      const date = new Date(typeof dateTime === 'string' ? dateTime : dateTime);
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
    } catch {
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

  isActive(record: any): boolean {
    return !record.exitUtc && !record.exitTime && !record.exitLocal;
  }

  trackByRecordId(index: number, record: any): string {
    return record.personId || record.id || index.toString();
  }

  trackByPageNumber(index: number, page: number | string): number | string {
    return page;
  }

  Math = Math;
}
