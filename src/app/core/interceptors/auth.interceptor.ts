import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, tap } from 'rxjs';
import { AuthService } from '../services/auth.service';

export const AuthInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const token = auth.getToken();

  if (token) {
    req = req.clone({
      setHeaders: { Authorization: `Bearer ${token}` }
    });
  } else {
    // Log warning if request is made without token (except for login endpoint)
    if (!req.url.includes('/api/auth/login')) {
      console.warn('⚠️ AuthInterceptor: Request made without token:', {
        url: req.url,
        method: req.method,
        timestamp: new Date().toISOString()
      });
    }
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
