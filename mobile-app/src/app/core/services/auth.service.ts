import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { BehaviorSubject, firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface SessionUser {
  username: string;
  role: string;
  roleLabel: string;
  pages: string[];
  homePath?: string;
  canManageUsers?: boolean;
  metricSections?: string[];
  aiTools?: string[];
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly base = environment.apiUrl;
  private readonly tokenKey = 'balderrama_mobile_token';
  private sessionSubject = new BehaviorSubject<SessionUser | null>(null);

  readonly session$ = this.sessionSubject.asObservable();

  constructor(private http: HttpClient) {}

  get session(): SessionUser | null {
    return this.sessionSubject.value;
  }

  get token(): string | null {
    return localStorage.getItem(this.tokenKey);
  }

  authHeaders(): HttpHeaders {
    const token = this.token;
    return token ? new HttpHeaders({ Authorization: `Bearer ${token}` }) : new HttpHeaders();
  }

  async ensureSession(): Promise<boolean> {
    if (this.sessionSubject.value) return true;
    if (!this.token) return false;
    try {
      const data = await firstValueFrom(
        this.http.get<SessionUser>(`${this.base}/api/auth/me`, { headers: this.authHeaders() }),
      );
      this.sessionSubject.next(data);
      return true;
    } catch {
      localStorage.removeItem(this.tokenKey);
      this.sessionSubject.next(null);
      return false;
    }
  }

  async login(username: string, password: string): Promise<void> {
    const result = await firstValueFrom(
      this.http.post<{ token: string; user: SessionUser }>(
        `${this.base}/api/auth/login`,
        { username, password },
      ),
    );
    localStorage.setItem(this.tokenKey, result.token);
    this.sessionSubject.next(result.user);
  }

  async logout(): Promise<void> {
    try {
      await firstValueFrom(
        this.http.post(`${this.base}/api/auth/logout`, {}, { headers: this.authHeaders() }),
      );
    } finally {
      localStorage.removeItem(this.tokenKey);
      this.sessionSubject.next(null);
    }
  }
}
