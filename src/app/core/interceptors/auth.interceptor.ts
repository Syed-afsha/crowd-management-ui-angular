import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError } from 'rxjs';
import { AuthService } from '../services/auth.service';

export const AuthInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const token = auth.getToken();

  // Skip token validation for login endpoint
  if (req.url.includes('/api/auth/login')) {
    return next(req);
  }

  if (token) {
    // Check if token is expired before making the request
    if (auth.isTokenExpired()) {
      console.warn('⚠️ AuthInterceptor: Token expired, request may fail:', {
        url: req.url,
        method: req.method,
        expiration: auth.getTokenExpiration(),
        timeUntilExpiration: auth.getTimeUntilExpiration(),
        timestamp: new Date().toISOString()
      });
      // Still proceed with request - let backend handle 401/403
      // This allows graceful handling of token expiration
    }
    
    req = req.clone({
      setHeaders: { Authorization: `Bearer ${token}` }
    });
  } else {
    // Log warning if request is made without token
    console.warn('⚠️ AuthInterceptor: Request made without token:', {
      url: req.url,
      method: req.method,
      timestamp: new Date().toISOString()
    });
  }

  return next(req).pipe(
    catchError(err => {
      // Log authentication errors
      if (err.status === 401 || err.status === 403) {
        console.error('❌ AuthInterceptor: Authentication error:', {
          status: err.status,
          statusText: err.statusText,
          message: err.message,
          url: req.url,
          method: req.method,
          hasToken: !!token,
          timestamp: new Date().toISOString()
        });
      }
      throw err; // Re-throw to let error handlers in components/services handle it
    })
  );
};
