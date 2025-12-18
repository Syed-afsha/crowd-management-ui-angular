import { Injectable, OnDestroy } from '@angular/core';
import { io, Socket } from 'socket.io-client';
import { Observable, Subject, share } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthService } from './auth.service';

@Injectable({ providedIn: 'root' })
export class SocketService implements OnDestroy {
  private socket: Socket | null = null;
  private isInitializing = false;
  private eventSubjects: Map<string, Subject<any>> = new Map();
  private reconnectAttempts = 0;
  private lastDisconnectReason: string | null = null;
  private suppressRoutineWarnings = false; // Flag to suppress routine disconnect warnings

  constructor(private auth: AuthService) {}

  private initializeSocket(): void {
    if (this.isInitializing || this.socket?.connected) {
      return;
    }

    const token = this.auth.getToken();
    if (!token) {
      console.warn('⚠️ SocketService: Cannot initialize socket - no token available');
      return;
    }

    // Check if token is expired before attempting connection
    if (this.auth.isTokenExpired()) {
      console.warn('⚠️ SocketService: Cannot initialize socket - token expired:', {
        expiration: this.auth.getTokenExpiration(),
        timeUntilExpiration: this.auth.getTimeUntilExpiration(),
        timestamp: new Date().toISOString()
      });
      return;
    }

    this.isInitializing = true;

    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
    }
    // Use environment API URL or use proxy in development
    // In development, proxy handles /socket.io routes to avoid CORS issues
    let socketUrl: string | undefined = environment.apiUrl;
    const isDevelopment = !environment.production;
    const useProxy = isDevelopment && (!socketUrl || socketUrl === '');
    
    if (useProxy) {
      // Use undefined to connect through Angular proxy (relative URL - current origin)
      // This avoids CORS issues in development
      socketUrl = undefined;
    } else if (!socketUrl || socketUrl === '') {
      // Fallback to backend API server (for production or when proxy not available)
      socketUrl = 'https://hiring-dev.internal.kloudspot.com';
    }
    
    // Remove trailing slash if present (only if URL is defined)
    if (socketUrl) {
      socketUrl = socketUrl.replace(/\/$/, '');
    }
    
    // Disable withCredentials to avoid CORS issues when backend uses wildcard CORS
    // Authentication is handled via Authorization header, so credentials aren't needed
    // withCredentials: true requires backend to specify exact origin, not wildcard '*'
    const useCredentials = false;
    
    this.socket = io(socketUrl, {
      transports: ['polling', 'websocket'], // Try polling first (more reliable), then upgrade to websocket
      upgrade: true,
      reconnection: true,
      reconnectionAttempts: Infinity, // Allow infinite reconnection attempts
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000, // Max 10 seconds between attempts
      randomizationFactor: 0.5, // Add randomness to prevent thundering herd
      timeout: 20000, // 20 second connection timeout
      path: '/socket.io/', // Default socket.io path
      withCredentials: useCredentials, // Set to false to work with wildcard CORS
      forceNew: false, // Reuse existing connection if available
      auth: {
        token: token
      },
      extraHeaders: {
        Authorization: `Bearer ${token}`
      }
      // Note: extraHeaders applies to both websocket and polling transports
      // Authentication is handled via Authorization header, not cookies
    });

    this.socket.on('connect', () => {
      this.isInitializing = false;
      this.reconnectAttempts = 0;
      this.suppressRoutineWarnings = false;
      const transport = this.socket?.io?.engine?.transport?.name || 'unknown';
      console.log(`✅ Socket.IO connected successfully (transport: ${transport})`);
    });

    this.socket.on('connect_error', (error: any) => {
      this.isInitializing = false;
      this.reconnectAttempts++;
      
      // Only log significant errors, not routine transport failures
      const isRoutineError = error.type === 'TransportError' && 
                            (error.message?.includes('websocket error') || 
                             error.message?.includes('xhr poll error'));
      
      if (!isRoutineError || this.reconnectAttempts === 1) {
        // Log first attempt or non-routine errors
        console.error('❌ Socket.IO connection error:', {
          message: error.message,
          type: error.type,
          transport: error.transport,
          attempt: this.reconnectAttempts,
          timestamp: new Date().toISOString()
        });
      }
      
      // If error is due to authentication, check token expiration
      if (error.message?.includes('auth') || error.message?.includes('token') || 
          error.message?.includes('401') || error.message?.includes('403')) {
        if (this.auth.isTokenExpired()) {
          console.warn('⚠️ Socket.IO: Connection failed due to expired token');
          // Disable reconnection if token is expired
          if (this.socket) {
            this.socket.disconnect();
          }
        }
      }
    });

    this.socket.on('disconnect', (reason) => {
      this.isInitializing = false;
      this.lastDisconnectReason = reason;
      
      // Suppress routine disconnect warnings during reconnection attempts
      // Only log if it's a significant disconnect reason or first disconnect
      const isRoutineDisconnect = reason === 'transport close' || 
                                  reason === 'ping timeout' ||
                                  (reason === 'transport error' && this.reconnectAttempts > 0);
      
      if (!isRoutineDisconnect || !this.suppressRoutineWarnings) {
        console.warn('⚠️ Socket.IO disconnected:', {
          reason: reason,
          timestamp: new Date().toISOString()
        });
      }
      
      // Enable suppression for routine disconnects during reconnection
      if (isRoutineDisconnect) {
        this.suppressRoutineWarnings = true;
      }
      
      // If disconnected due to authentication issues, don't auto-reconnect if token is expired
      if (reason === 'io server disconnect' || reason === 'transport close') {
        if (this.auth.isTokenExpired()) {
          console.warn('⚠️ Socket.IO: Not reconnecting - token expired');
          if (this.socket) {
            this.socket.disconnect();
          }
        }
      }
    });
    
    // Track reconnection attempts
    this.socket.on('reconnect_attempt', (attemptNumber) => {
      this.reconnectAttempts = attemptNumber;
      // Suppress warnings during reconnection attempts
      this.suppressRoutineWarnings = true;
    });
    
    this.socket.on('reconnect', (attemptNumber) => {
      this.reconnectAttempts = 0;
      this.suppressRoutineWarnings = false;
      console.log(`✅ Socket.IO reconnected after ${attemptNumber} attempt(s)`);
    });
    
    this.socket.on('reconnect_failed', () => {
      this.suppressRoutineWarnings = false;
      console.error('❌ Socket.IO: Reconnection failed after all attempts');
    });
  }

  reconnect(): void {
    if (this.socket?.connected) {
      return;
    }
    
    // Check token before attempting reconnection
    const token = this.auth.getToken();
    if (!token || this.auth.isTokenExpired()) {
      console.warn('⚠️ SocketService: Cannot reconnect - token missing or expired');
      return;
    }
    
    this.initializeSocket();
  }

  listen(event: string): Observable<any> {
    // Shared observable pattern: one socket listener per event, multiple subscribers share the same observable
    if (!this.eventSubjects.has(event)) {
      const subject = new Subject<any>();
      this.eventSubjects.set(event, subject);

      const setupListener = () => {
        if (!this.socket) return;
        this.socket.off(event);
        this.socket.on(event, (data: any) => {
          subject.next(data);
        });
      };

      if (!this.socket && !this.isInitializing) {
        // Check token before initializing
        const token = this.auth.getToken();
        if (token && !this.auth.isTokenExpired()) {
          this.initializeSocket();
        } else {
          console.warn('⚠️ SocketService: Cannot setup listener - token missing or expired');
        }
      }

      if (this.socket?.connected) {
        setupListener();
      } else if (this.socket) {
        const connectHandler = () => {
          setupListener();
          if (this.socket) {
            this.socket.off('connect', connectHandler);
          }
        };
        this.socket.on('connect', connectHandler);
      } else {
        // Wait for socket initialization using a retry mechanism
        const checkConnection = () => {
          if (this.socket?.connected) {
            setupListener();
          } else if (this.socket) {
            const connectHandler = () => {
              setupListener();
              if (this.socket) {
                this.socket.off('connect', connectHandler);
              }
            };
            this.socket.on('connect', connectHandler);
          } else {
            // Retry after a short delay if socket is still initializing
            requestAnimationFrame(() => {
              if (this.socket && !this.socket.connected) {
                setTimeout(checkConnection, 100);
              }
            });
          }
        };
        checkConnection();
      }
    }

    return this.eventSubjects.get(event)!.asObservable().pipe(share());
  }

  /**
   * Check if socket connection is healthy (connected and token is valid)
   */
  isConnectionHealthy(): boolean {
    if (!this.socket?.connected) {
      return false;
    }
    
    const token = this.auth.getToken();
    if (!token || this.auth.isTokenExpired()) {
      return false;
    }
    
    return true;
  }

  /**
   * Get connection status information
   */
  getConnectionStatus(): {
    connected: boolean;
    tokenValid: boolean;
    tokenExpired: boolean;
    timeUntilExpiration: number;
  } {
    const token = this.auth.getToken();
    const tokenExpired = !token || this.auth.isTokenExpired();
    
    return {
      connected: this.socket?.connected || false,
      tokenValid: !!token && !tokenExpired,
      tokenExpired: tokenExpired,
      timeUntilExpiration: this.auth.getTimeUntilExpiration()
    };
  }

  disconnect(): void {
    this.eventSubjects.forEach(subject => subject.complete());
    this.eventSubjects.clear();

    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
    }
    this.isInitializing = false;
  }

  ngOnDestroy(): void {
    this.disconnect();
  }
}
