import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthService } from './auth.service';

export type AiHighlight = { label: string; value: string };

export type AiChatResult = {
  reply: string;
  highlights?: AiHighlight[];
  toolsUsed?: string[];
  scope?: { role: string; roleLabel: string; tools: string[] };
  model?: string;
  source?: string;
};

export type AiStatus = {
  ok: boolean;
  configured: boolean;
  model?: string;
  role?: string;
  tools?: string[];
  sections?: string[];
};

function monthRange(): { fechaInicio: string; fechaFin: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const last = new Date(y, now.getMonth() + 1, 0).getDate();
  return {
    fechaInicio: `${y}-${m}-01`,
    fechaFin: `${y}-${m}-${String(last).padStart(2, '0')}`,
  };
}

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly base = environment.apiUrl;

  constructor(
    private http: HttpClient,
    private auth: AuthService,
  ) {}

  private params(range = monthRange()) {
    return new HttpParams()
      .set('fechaInicio', range.fechaInicio)
      .set('fechaFin', range.fechaFin);
  }

  getOverview(range = monthRange()) {
    return firstValueFrom(
      this.http.get<Record<string, unknown>>(`${this.base}/api/mobile/overview`, {
        params: this.params(range),
        headers: this.auth.authHeaders(),
      }),
    );
  }

  getVentas(range = monthRange()) {
    return firstValueFrom(
      this.http.get<Record<string, unknown>>(`${this.base}/api/mobile/ventas`, {
        params: this.params(range),
        headers: this.auth.authHeaders(),
      }),
    );
  }

  getInventory(range = monthRange()) {
    return firstValueFrom(
      this.http.get<Record<string, unknown>>(`${this.base}/api/mobile/inventory`, {
        params: this.params(range),
        headers: this.auth.authHeaders(),
      }),
    );
  }

  getMetricsSection(section: string, range = monthRange(), extras: { area?: string; estatus?: string } = {}) {
    let params = this.params(range);
    if (extras.area) params = params.set('area', extras.area);
    if (extras.estatus) params = params.set('estatus', extras.estatus);
    return firstValueFrom(
      this.http.get<Record<string, unknown>>(`${this.base}/api/mobile/metrics/${section}`, {
        params,
        headers: this.auth.authHeaders(),
      }),
    );
  }

  getAiStatus() {
    return firstValueFrom(
      this.http.get<AiStatus>(`${this.base}/api/mobile/ai/status`, {
        headers: this.auth.authHeaders(),
      }),
    );
  }

  chatAi(messages: Array<{ role: 'user' | 'assistant'; content: string }>) {
    return firstValueFrom(
      this.http.post<AiChatResult>(
        `${this.base}/api/mobile/ai/chat`,
        { messages },
        { headers: this.auth.authHeaders() },
      ),
    );
  }

  getHealth() {
    return firstValueFrom(
      this.http.get<{ ok: boolean }>(`${this.base}/api/health`),
    );
  }
}
