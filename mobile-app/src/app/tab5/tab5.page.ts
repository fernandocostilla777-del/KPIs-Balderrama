import { Component, OnInit, ViewChild } from '@angular/core';
import { IonContent } from '@ionic/angular';
import { ApiService, AiChatResult, AiHighlight } from '../core/services/api.service';
import { AuthService } from '../core/services/auth.service';

type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
  highlights?: AiHighlight[];
  toolsUsed?: string[];
};

const PROMPT_BY_ROLE: Record<string, string[]> = {
  administracion: [
    'Resumen ejecutivo del mes',
    '¿Cómo va la cobertura SOFIA?',
    'Top hallazgo de ventas',
    'Estado de postventa',
  ],
  direccion: [
    'Resumen ejecutivo del mes',
    '¿Cómo va la cobertura SOFIA?',
    'Ventas vs inventario',
    'Conversión de leads',
  ],
  gerencia_comercial: [
    '¿Cómo van las ventas del mes?',
    'Pronóstico próximo mes',
    'Conversión lead → compra',
    'Top canal de ventas',
  ],
  contabilidad: [
    'Resumen contable del periodo',
    '¿Cuál es la utilidad?',
    'Punto clave del EEFF',
    'Margen del mes',
  ],
};

@Component({
  selector: 'app-tab5',
  templateUrl: 'tab5.page.html',
  styleUrls: ['tab5.page.scss'],
  standalone: false,
})
export class Tab5Page implements OnInit {
  @ViewChild(IonContent) content?: IonContent;

  messages: ChatMessage[] = [];
  draft = '';
  loading = false;
  ready = false;
  error = '';
  prompts: string[] = [];
  roleLabel = '';

  constructor(
    private api: ApiService,
    private auth: AuthService,
  ) {}

  async ngOnInit() {
    const user = this.auth.session;
    this.roleLabel = user?.roleLabel || user?.role || '';
    this.prompts = PROMPT_BY_ROLE[user?.role || 'direccion'] || PROMPT_BY_ROLE['direccion'];

    try {
      const status = await this.api.getAiStatus();
      this.ready = Boolean(status.configured);
      if (!this.ready) {
        this.error = 'El asistente no está configurado en Cloud API (OPENAI_API_KEY).';
      } else {
        this.messages = [{
          role: 'assistant',
          content: `Hola${user?.username ? `, ${user.username}` : ''}. Soy tu asistente móvil (${this.roleLabel}). Pregúntame en corto; te respondo solo con lo esencial de tu alcance.`,
        }];
      }
    } catch {
      this.error = 'No se pudo verificar el asistente. Revisa la sesión y la URL del API.';
    }
  }

  usePrompt(text: string) {
    this.draft = text;
    void this.send();
  }

  async send() {
    const text = this.draft.trim();
    if (!text || this.loading || !this.ready) return;

    this.draft = '';
    this.error = '';
    this.messages.push({ role: 'user', content: text });
    this.loading = true;
    await this.scrollBottom();

    try {
      const history = this.messages
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .slice(-10)
        .map((m) => ({ role: m.role, content: m.content }));

      const result: AiChatResult = await this.api.chatAi(history);
      this.messages.push({
        role: 'assistant',
        content: result.reply || 'Sin respuesta.',
        highlights: (result.highlights || []).slice(0, 4),
        toolsUsed: result.toolsUsed || [],
      });
    } catch (err: unknown) {
      const httpErr = err as { error?: { error?: string }; message?: string };
      const msg = httpErr?.error?.error || httpErr?.message || '';
      this.messages.push({
        role: 'assistant',
        content: msg || 'No pude responder ahora. Intenta de nuevo.',
      });
    } finally {
      this.loading = false;
      await this.scrollBottom();
    }
  }

  clearChat() {
    this.messages = [{
      role: 'assistant',
      content: `Chat limpio. ¿Qué necesitas ver de ${this.roleLabel || 'tu rol'}?`,
    }];
  }

  private async scrollBottom() {
    await new Promise((r) => setTimeout(r, 60));
    await this.content?.scrollToBottom(250);
  }
}
