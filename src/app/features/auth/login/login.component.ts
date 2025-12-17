import { Component } from '@angular/core';
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
          this.router.navigate(['/']);
        } else {
          this.error = 'Login failed: No token received';
          this.loading = false;
        }
      },
      error: (err) => {
        // Security: Never log credentials, tokens, or detailed error info
        // Show user-friendly error messages only
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
