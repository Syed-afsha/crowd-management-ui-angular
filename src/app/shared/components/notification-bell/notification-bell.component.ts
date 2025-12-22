import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { NotificationService, Alert } from '../../../core/services/notification.service';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-notification-bell',
  standalone: true,
  imports: [CommonModule, MatIconModule],
  templateUrl: './notification-bell.component.html',
  styleUrls: ['./notification-bell.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class NotificationBellComponent implements OnInit, OnDestroy {
  showDropdown = false;
  alerts: (Alert & { _formattedDate?: string; _priority?: string; _displayText?: string })[] = [];
  unreadCount = 0;
  private subscription?: Subscription;
  // Cache for formatted dates to avoid recalculating on every change detection
  private dateCache = new Map<string, string>();

  constructor(
    public notificationService: NotificationService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    // Subscribe to alert changes (backend handles all filtering)
    this.subscription = this.notificationService.alerts$.subscribe(() => {
      const rawAlerts = this.notificationService.getAlerts();
      this.alerts = rawAlerts.map(alert => ({
        ...alert,
        _formattedDate: this.formatAlertDate(alert.timestamp),
        _priority: this.getPriorityLabel(alert.severity),
        _displayText: this.formatDisplayText(alert)
      }));
      this.unreadCount = this.notificationService.getUnreadCount();
      this.cdr.markForCheck();
    });
    
    // Initialize with alerts and pre-process them
    const rawAlerts = this.notificationService.getAlerts();
    this.alerts = rawAlerts.map(alert => ({
      ...alert,
      _formattedDate: this.formatAlertDate(alert.timestamp),
      _priority: this.getPriorityLabel(alert.severity),
      _displayText: this.formatDisplayText(alert)
    }));
    this.unreadCount = this.notificationService.getUnreadCount();
    this.cdr.markForCheck();
  }

  ngOnDestroy(): void {
    if (this.subscription) {
      this.subscription.unsubscribe();
    }
    this.dateCache.clear();
  }

  toggleDropdown(): void {
    this.showDropdown = !this.showDropdown;
    this.cdr.markForCheck();
  }

  closeDropdown(): void {
    this.showDropdown = false;
    this.cdr.markForCheck();
  }

  formatAlertDate(timestamp: number | string): string {
    const cacheKey = String(timestamp);
    const cached = this.dateCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      const date = new Date(typeof timestamp === 'string' ? timestamp : timestamp);
      if (isNaN(date.getTime())) {
        const result = 'Invalid date';
        this.dateCache.set(cacheKey, result);
        return result;
      }

      // Format: "March 03 2025 10:12"
      const months = ['January', 'February', 'March', 'April', 'May', 'June', 
                     'July', 'August', 'September', 'October', 'November', 'December'];
      const month = months[date.getMonth()];
      const day = date.getDate().toString().padStart(2, '0');
      const year = date.getFullYear();
      const hours = date.getHours().toString().padStart(2, '0');
      const minutes = date.getMinutes().toString().padStart(2, '0');

      const result = `${month} ${day} ${year} ${hours}:${minutes}`;
      this.dateCache.set(cacheKey, result);
      return result;
    } catch (err) {
      console.error('❌ NotificationBell: Error formatting alert date:', {
        error: err,
        timestamp: timestamp
      });
      const result = 'Invalid date';
      this.dateCache.set(cacheKey, result);
      return result;
    }
  }

  getPriorityLabel(severity: string): string {
    // Map severity to priority labels (High/Medium/Low)
    const severityLower = severity?.toLowerCase() || '';
    if (severityLower === 'high' || severityLower === 'critical') {
      return 'High';
    } else if (severityLower === 'medium') {
      return 'Medium';
    } else {
      return 'Low';
    }
  }

  formatDisplayText(alert: Alert): string {
    // Extract person name from message or raw data
    // Message format: "John Doe entered Tokyo Station" or "John Doe exited Tokyo Station"
    let personName = '';
    
    // Try to get person name from raw data first
    if (alert.raw?.personName) {
      personName = alert.raw.personName;
    } else if (alert.raw?.name) {
      personName = alert.raw.name;
    } else {
      // Extract name from message (format: "Name entered/exited Zone")
      const message = alert.message || '';
      // Match pattern: "Name entered" or "Name exited"
      const nameMatch = message.match(/^(.+?)\s+(entered|exited)/i);
      if (nameMatch && nameMatch[1]) {
        personName = nameMatch[1].trim();
      }
    }
    
    // Get action type (entry or exit)
    const actionType = alert.actionType?.toLowerCase() || '';
    const isEntry = actionType === 'entry' || actionType === 'enter';
    const actionText = isEntry ? 'entered' : 'exited';
    
    // Return formatted text: "Name entered" or "Name exited"
    if (personName) {
      return `${personName} ${actionText}`;
    } else {
      // Fallback if no name found
      return isEntry ? 'Entry' : 'Exit';
    }
  }

  trackByAlertId(index: number, alert: Alert): string {
    return alert.raw?.eventId || alert.timestamp?.toString() || index.toString();
  }
}

