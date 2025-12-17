import { Component, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { AuthService } from '../../../core/services/auth.service';

@Component({
  standalone: true,
  selector: 'app-login',
  imports: [CommonModule, ReactiveFormsModule, MatIconModule],
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.scss']
})
export class LoginComponent {
  @ViewChild('passwordInput') passwordInput!: ElementRef<HTMLInputElement>;
  
  loading = false;
  error = '';
  showPassword = false;

  form = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', Validators.required]
  });

  constructor(
    private fb: FormBuilder,
    private auth: AuthService,
    private router: Router
  ) {}

  onEmailEnter(event: Event): void {
    event.preventDefault();
    // Move focus to password field when Enter is pressed in email field
    if (this.passwordInput?.nativeElement) {
      this.passwordInput.nativeElement.focus();
    }
  }

  togglePassword(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    this.showPassword = !this.showPassword;
  }

  submit(): void {
    if (this.form.invalid) return;

    this.loading = true;
    this.error = '';

    const { email, password } = this.form.value;

    this.auth.login(email!, password!).subscribe({
      next: res => {
        if (res?.token) {
          // Clear any stale caches before navigation
          // Note: ApiService and SocketService will be reinitialized on dashboard load
          this.router.navigate(['/']);
        } else {
          this.error = 'Login failed: No token received';
          this.loading = false;
        }
      },
      error: (err) => {
        // Log all login errors to console for debugging
        console.error('❌ Login error:', {
          status: err.status,
          statusText: err.statusText,
          message: err.message,
          error: err.error,
          url: err.url,
          timestamp: new Date().toISOString()
        });
        
        // Show user-friendly error messages
        if (err.status === 0) {
          this.error = 'Network error: Cannot connect to server. Please check your connection.';
        } else if (err.status === 401) {
          this.error = 'Invalid credentials';
        } else if (err.status === 404) {
          this.error = 'API endpoint not found. Please contact support.';
        } else if (err.status >= 500) {
          this.error = 'Server error. Please try again later.';
        } else {
          this.error = err.error?.message || 'Login failed. Please try again.';
        }
        this.loading = false;
      }
    });
  }
}
