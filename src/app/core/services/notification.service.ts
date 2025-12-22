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
  private selectedDate: Date = new Date(); // Kept for backward compatibility, but not used for filtering
  private currentSiteId: string | null = null; // Kept for backward compatibility, but not used for filtering

  addAlert(alert: Alert): void {
    this.alerts.unshift(alert);
    // Limit alerts to prevent memory issues
    if (this.alerts.length > this.MAX_ALERTS) {
      this.alerts = this.alerts.slice(0, this.MAX_ALERTS);
    }
    // Emit filtered alerts (only for current site) to trigger change detection
    this.alertsSubject.next([...this.getAlerts()]);
  }

  getAlerts(): Alert[] {
    // Filter alerts by current site ID
    if (!this.currentSiteId) {
      return [];
    }
    return this.alerts.filter(alert => {
      // Match alert's siteId with current site ID
      return alert.siteId === this.currentSiteId;
    });
  }

  getUnreadCount(): number {
    // Count only alerts for current site
    return this.getAlerts().length;
  }

  clearAlerts(): void {
    this.alerts = [];
    this.alertsSubject.next([]);
  }

  // Backend handles date and site filtering, so we don't need these for filtering
  // Keeping for backward compatibility but they don't affect alerts anymore
  setSelectedDate(date: Date): void {
    this.selectedDate = date;
    // Re-emit filtered alerts
    this.alertsSubject.next([...this.getAlerts()]);
  }

  getSelectedDate(): Date {
    return this.selectedDate;
  }

  setCurrentSiteId(siteId: string | null): void {
    this.currentSiteId = siteId;
    // Re-emit filtered alerts when site changes
    this.alertsSubject.next([...this.getAlerts()]);
  }

  getCurrentSiteId(): string | null {
    return this.currentSiteId;
  }

  // Filter alerts by current site ID
  getFilteredAlerts(): Alert[] {
    return this.getAlerts();
  }

  getFilteredUnreadCount(): number {
    return this.getUnreadCount();
  }
}

