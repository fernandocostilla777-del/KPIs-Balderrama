import { Component, OnInit } from '@angular/core';
import { ApiService } from '../core/services/api.service';
import { AuthService } from '../core/services/auth.service';

type MetricItem = {
  label: string;
  count?: number;
  value?: number;
  money?: boolean;
  suffix?: string;
  sub?: string;
};

type MetricList = {
  title: string;
  type: 'bars' | 'list';
  items: MetricItem[];
};

type MetricGroup = {
  title: string;
  items: MetricItem[];
};

type MetricSection = {
  id: string;
  label: string;
  icon: string;
};

type AreaOption = {
  id: string;
  label: string;
};

const ALL_SECTIONS: MetricSection[] = [
  { id: 'ventas', label: 'Ventas', icon: 'bar-chart-outline' },
  { id: 'forecast', label: 'Pronóstico', icon: 'trending-up-outline' },
  { id: 'inventory', label: 'Inventario', icon: 'cube-outline' },
  { id: 'contabilidad', label: 'Contabilidad', icon: 'wallet-outline' },
  { id: 'post-sales', label: 'Postventa', icon: 'construct-outline' },
];

const POSTVENTA_AREAS: AreaOption[] = [
  { id: 'posventa', label: 'PostVenta' },
  { id: 'servicio', label: 'Servicio' },
  { id: 'hyp', label: 'HyP' },
];

@Component({
  selector: 'app-tab2',
  templateUrl: 'tab2.page.html',
  styleUrls: ['tab2.page.scss'],
  standalone: false,
})
export class Tab2Page implements OnInit {
  loading = true;
  error = '';
  selectedSection = 'ventas';
  selectedArea = 'posventa';

  sections: MetricSection[] = [];
  postventaAreas = POSTVENTA_AREAS;

  title = 'Ventas';
  heroLabel = 'Ventas del periodo';
  heroValue: number | string = 0;
  heroHint = 'Unidades · mes en curso';
  heroMoney = false;
  kpis: MetricItem[] = [];
  kpiGroups: MetricGroup[] = [];
  lists: MetricList[] = [];

  constructor(
    private api: ApiService,
    private auth: AuthService,
  ) {}

  async ngOnInit() {
    const allowed = new Set(this.auth.session?.metricSections || ALL_SECTIONS.map((s) => s.id));
    this.sections = ALL_SECTIONS.filter((s) => allowed.has(s.id));
    if (!this.sections.length) {
      this.error = 'Tu rol no tiene secciones de métricas.';
      this.loading = false;
      return;
    }
    if (!this.sections.some((s) => s.id === this.selectedSection)) {
      this.selectedSection = this.sections[0].id;
    }
    await this.load();
  }

  get isPostventa() {
    return this.selectedSection === 'post-sales';
  }

  async onSectionChange() {
    if (!this.isPostventa) this.selectedArea = 'posventa';
    await this.load();
  }

  async onAreaChange(areaId: string) {
    if (this.selectedArea === areaId) return;
    this.selectedArea = areaId;
    await this.load();
  }

  async load(event?: CustomEvent) {
    this.loading = !event;
    this.error = '';
    try {
      const extras = this.isPostventa ? { area: this.selectedArea } : {};
      const data = await this.api.getMetricsSection(this.selectedSection, undefined, extras);
      const hero = (data['hero'] || {}) as Record<string, unknown>;
      this.title = String(data['title'] || this.currentSectionLabel);
      this.heroLabel = String(hero['label'] || this.title);
      this.heroValue = Number(hero['value'] || 0);
      this.heroHint = String(hero['hint'] || '');
      this.heroMoney = Boolean(hero['money']);

      if (Array.isArray(data['areas']) && data['areas'].length) {
        this.postventaAreas = (data['areas'] as AreaOption[]).map((a) => ({
          id: String(a.id),
          label: String(a.label),
        }));
      }

      this.kpis = this.mapItems((data['kpis'] || []) as MetricItem[]);
      this.kpiGroups = ((data['kpiGroups'] || []) as MetricGroup[]).map((group) => ({
        title: group.title,
        items: this.mapItems(group.items || []),
      }));
      this.lists = ((data['lists'] || []) as MetricList[]).map((list) => ({
        title: list.title,
        type: list.type === 'bars' ? 'bars' : 'list',
        items: (list.items || []).map((item) => ({
          label: item.label,
          count: Number(item.count ?? item.value ?? 0),
          value: Number(item.value ?? item.count ?? 0),
          money: Boolean(item.money),
          suffix: item.suffix,
          sub: item.sub,
        })),
      }));
    } catch {
      this.error = `No se pudieron cargar las métricas de ${this.currentSectionLabel.toLowerCase()}.`;
      this.kpis = [];
      this.kpiGroups = [];
      this.lists = [];
    } finally {
      this.loading = false;
      event?.target && (event.target as HTMLIonRefresherElement).complete();
    }
  }

  private mapItems(items: MetricItem[]) {
    return (items || []).map((item) => ({
      label: item.label,
      value: Number(item.value ?? item.count ?? 0),
      money: Boolean(item.money),
      suffix: item.suffix,
      sub: item.sub,
    }));
  }

  get currentSectionLabel() {
    return this.sections.find((section) => section.id === this.selectedSection)?.label || 'Métricas';
  }

  barWidth(count: number, items: MetricItem[]) {
    const max = Math.max(...items.map((item) => Number(item.count || item.value || 0)), 1);
    return Math.round((Number(count || 0) / max) * 100);
  }

  formatValue(item: MetricItem) {
    const value = Number(item.value ?? item.count ?? 0);
    if (item.money) return this.formatMoney(value);
    if (item.suffix === '%') {
      const rounded = Math.round(value * 10) / 10;
      return `${rounded.toLocaleString('es-MX', { minimumFractionDigits: 0, maximumFractionDigits: 1 })}%`;
    }
    if (item.suffix) return `${value.toLocaleString('es-MX')}${item.suffix}`;
    return value.toLocaleString('es-MX');
  }

  formatHeroValue() {
    const value = Number(this.heroValue || 0);
    return this.heroMoney ? this.formatMoney(value) : value.toLocaleString('es-MX');
  }

  formatMoney(n: number) {
    if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
    if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
    return `$${Math.round(n).toLocaleString('es-MX')}`;
  }
}
