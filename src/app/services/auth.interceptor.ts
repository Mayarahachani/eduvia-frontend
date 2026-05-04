import { Injectable } from '@angular/core';
import { HttpErrorResponse, HttpInterceptor, HttpRequest, HttpHandler, HttpEvent } from '@angular/common/http';
import { Observable, catchError, switchMap, throwError } from 'rxjs';
import { AuthService } from './auth.service';

@Injectable()
export class AuthInterceptor implements HttpInterceptor {
  constructor(private authService: AuthService) {}

  private redirectToLoginWithRole(role: string | null) {
    if (typeof window === 'undefined') {
      return;
    }

    const query = role ? `?role=${encodeURIComponent(role)}` : '';
    window.location.href = `${window.location.pathname}${query}`;
  }

  intercept(req: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {
    const token = this.authService.getToken();

    const authReq = token
      ? req.clone({
          setHeaders: {
            Authorization: `Bearer ${token}`,
          },
        })
      : req;

    return next.handle(authReq).pipe(
      catchError((error: HttpErrorResponse) => {
        const storedRole = localStorage.getItem('role');
        const isPublicAuthFailure =
          req.url.includes('/auth/login') ||
          req.url.includes('/auth/face-id/login') ||
          req.url.includes('/auth/forgot-password') ||
          req.url.includes('/auth/reset-password');

        if (error.status === 401 && !this.authService.hasRefreshToken() && !isPublicAuthFailure) {
          this.authService.clearTokens();
          this.redirectToLoginWithRole(storedRole);
          return throwError(() => error);
        }

        const shouldAttemptRefresh =
          error.status === 401 &&
          !req.url.includes('/auth/login') &&
          !req.url.includes('/auth/face-id/login') &&
          !req.url.includes('/auth/logout') &&
          !req.url.includes('/auth/refresh');

        if (!shouldAttemptRefresh) {
          return throwError(() => error);
        }

        return this.authService.refreshToken().pipe(
          switchMap((response) => {
            const data = response?.data || response || {};
            const refreshedToken = data?.access_token || this.authService.getToken();

            if (!refreshedToken) {
              this.authService.clearTokens();
              return throwError(() => error);
            }

            const retryReq = req.clone({
              setHeaders: {
                Authorization: `Bearer ${refreshedToken}`,
              },
            });

            return next.handle(retryReq);
          }),
          catchError((refreshError) => {
            this.authService.clearTokens();
            this.redirectToLoginWithRole(storedRole);
            return throwError(() => refreshError);
          }),
        );
      }),
    );
  }
}
