import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { tap } from 'rxjs';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private tokenKey = 'ks_auth_token';
  private siteIdKey = 'ks_site_id';
  private userKey = 'ks_user_info';

  constructor(private http: HttpClient) {}

  login(email: string, password: string) {
    const url = `${environment.apiUrl}/api/auth/login`;
    return this.http
      .post<any>(url, { email, password })
      .pipe(
        tap({
          next: (res) => {
            if (res?.token) {
              localStorage.setItem(this.tokenKey, res.token);
              // Store user info if available in response
              if (res.user || res.email || res.name || res.username) {
                const userInfo = {
                  email: res.email || res.user?.email || email,
                  name: res.name || res.user?.name || res.username || res.user?.username || email.split('@')[0],
                  imageUrl: res.imageUrl || res.user?.imageUrl || res.avatar || res.user?.avatar || res.profileImage || res.user?.profileImage || null
                };
                localStorage.setItem(this.userKey, JSON.stringify(userInfo));
              } else {
                // Store basic info from email
                const userInfo = {
                  email: email,
                  name: email.split('@')[0],
                  imageUrl: null
                };
                localStorage.setItem(this.userKey, JSON.stringify(userInfo));
              }
            } else {
              console.error('❌ Login response missing token:', res);
            }
          },
          error: (err) => {
            console.error('❌ AuthService login error:', {
              status: err.status,
              statusText: err.statusText,
              message: err.message,
              error: err.error,
              url: url,
              timestamp: new Date().toISOString()
            });
          }
        })
      );
  }

  getUserInfo(): { email: string; name: string; imageUrl: string | null } | null {
    const userStr = localStorage.getItem(this.userKey);
    if (userStr) {
      try {
        return JSON.parse(userStr);
      } catch {
        return null;
      }
    }
    return null;
  }

  getToken(): string | null {
    return localStorage.getItem(this.tokenKey);
  }

  isLoggedIn(): boolean {
    return !!this.getToken();
  }

  logout(): void {
    localStorage.removeItem(this.tokenKey);
    localStorage.removeItem(this.siteIdKey);
    localStorage.removeItem(this.userKey);
  }

  getSiteId(): string | null {
    return localStorage.getItem(this.siteIdKey);
  }

  setSiteId(siteId: string): void {
    localStorage.setItem(this.siteIdKey, siteId);
  }
}
