import { ApplicationConfig } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideAnimations } from '@angular/platform-browser/animations';

import { routes } from './app.routes';
import { AuthInterceptor } from './core/interceptors/auth.interceptor';
import { CacheInterceptor } from './core/interceptors/cache.interceptor';

// Suppress Angular animation warnings for non-animatable properties
const originalWarn = console.warn;
console.warn = function(...args: any[]) {
  const message = args[0]?.toString() || '';
  if (message.includes('strokeDashoffset') || 
      message.includes('not animatable properties') ||
      message.includes('animationState')) {
    return;
  }
  originalWarn.apply(console, args);
};

// Global error handler to catch all unhandled errors
const originalError = console.error;
window.addEventListener('error', (event) => {
  console.error('🚨 Global Error Handler - Unhandled Error:', {
    message: event.message,
    filename: event.filename,
    lineno: event.lineno,
    colno: event.colno,
    error: event.error,
    stack: event.error?.stack,
    timestamp: new Date().toISOString()
  });
});

window.addEventListener('unhandledrejection', (event) => {
  console.error('🚨 Global Error Handler - Unhandled Promise Rejection:', {
    reason: event.reason,
    promise: event.promise,
    timestamp: new Date().toISOString()
  });
  // Prevent default browser behavior
  event.preventDefault();
});

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes),
    provideHttpClient(withInterceptors([CacheInterceptor, AuthInterceptor])),
    provideAnimations()
  ]
};
