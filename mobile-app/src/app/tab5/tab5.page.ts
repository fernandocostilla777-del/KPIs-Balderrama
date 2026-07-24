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

const WELCOME_MESSAGE =
  'Soy tu asistente de Administración IA.\n'
  + 'Analizo tu duda para obtener respuestas claras, precisas y útiles para la toma de decisiones.';

const PROMPT_BY_ROLE: Record<string, string[]> = {
  administracion: [
    'Resumen ejecutivo del mes',
    '¿Cuántas órdenes HyP hay abiertas?',
    '¿Cómo va la cobertura SOFIA?',
    'Estado de postventa',
  ],
  direccion: [
    'Resumen ejecutivo del mes',
    '¿Cuántas órdenes HyP hay abiertas?',
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
          content: WELCOME_MESSAGE,
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
      content: WELCOME_MESSAGE,
    }];
  }

  /** Render ligero tipo web: ### secciones, **negrita**, listas. */
  formatReply(text: string): string {
    const escaped = String(text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    let html = escaped;
    html = html.replace(/^### (.+)$/gm, '<h4 class="md-h4">$1</h4>');
    html = html.replace(/^## (.+)$/gm, '<h3 class="md-h3">$1</h3>');
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/^\s*[-*]\s+(.+)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>[\s\S]*?<\/li>\s*)+/g, (block) => `<ul class="md-list">${block}</ul>`);
    html = html.replace(/\n{2,}/g, '<br/><br/>');
    html = html.replace(/\n/g, '<br/>');
    return html;
  }

  private async scrollBottom() {
    await new Promise((r) => setTimeout(r, 60));
    await this.content?.scrollToBottom(250);
  }
}
