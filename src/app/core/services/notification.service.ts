import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

export interface Alert {
  actionType: string;
  zone: string;
  site: string;
  siteId?: string; // Add siteId to track which site the alert belongs to
  severity: string;
  timestamp: number | string;
  message: string;
  raw: any;
}

@Injectable({ providedIn: 'root' })
export class NotificationService {
  private alerts: Alert[] = [];
  private alertsSubject = new Subject<Alert[]>();
  public alerts$ = this.alertsSubject.asObservable();
  private readonly MAX_ALERTS = 50;
  private selectedDate: Date = new Date();
  private currentSiteId: string | null = null; // Track current site for filtering

  addAlert(alert: Alert): void {
    this.alerts.unshift(alert);
    // Limit alerts to prevent memory issues
    if (this.alerts.length > this.MAX_ALERTS) {
      this.alerts = this.alerts.slice(0, this.MAX_ALERTS);
    }
    // Emit a new array reference to trigger change detection in OnPush components
    this.alertsSubject.next([...this.alerts]);
  }

  getAlerts(): Alert[] {
    // Return reference directly for OnPush components (they track changes via subscription)
    return this.alerts;
  }

  getUnreadCount(): number {
    return this.alerts.length;
  }

  clearAlerts(): void {
    this.alerts = [];
    this.alertsSubject.next([]);
  }

  setSelectedDate(date: Date): void {
    this.selectedDate = date;
    // Re-emit alerts to trigger filtering in components
    this.alertsSubject.next([...this.alerts]);
  }

  getSelectedDate(): Date {
    return this.selectedDate;
  }

  setCurrentSiteId(siteId: string | null): void {
    this.currentSiteId = siteId;
    // Re-emit alerts to trigger filtering when site changes
    this.alertsSubject.next([...this.alerts]);
  }

  getCurrentSiteId(): string | null {
    return this.currentSiteId;
  }

  getFilteredAlerts(): Alert[] {
    // Compare dates using local date values (consistent with dashboard component)
    // Dashboard component normalizes dates using local date methods, so we do the same here
    const today = new Date();
    const todayUtc = new Date(Date.UTC(
      today.getFullYear(),  // Use local year
      today.getMonth(),     // Use local month
      today.getDate(),      // Use local date
      0, 0, 0, 0
    ));
    // selectedDate is already normalized to UTC midnight using local date values by dashboard component
    const selectedUtc = new Date(this.selectedDate);
    
    // Only show notifications for today (match dashboard logic)
    if (selectedUtc.getTime() !== todayUtc.getTime()) {
      return [];
    }
    
    // Filter alerts by current siteId if set
    if (this.currentSiteId) {
      return this.alerts.filter(alert => {
        // Match by siteId if available, otherwise match by site name
        if (alert.siteId) {
          return alert.siteId === this.currentSiteId;
        }
        // Fallback: try to match by site name (in case siteId is not in alert data)
        // This handles cases where alert only has site name
        return alert.site === this.currentSiteId || alert.raw?.siteId === this.currentSiteId;
      });
    }
    
    // If no site is selected, return all alerts (shouldn't happen in normal flow)
    return this.alerts;
  }

  getFilteredUnreadCount(): number {
    return this.getFilteredAlerts().length;
  }
}

