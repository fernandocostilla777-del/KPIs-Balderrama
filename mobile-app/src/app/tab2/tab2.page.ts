import { Component, OnInit } from '@angular/core';
import { ApiService } from '../core/services/api.service';

type MetricItem = {
  label: string;
  count?: number;
  value?: number;
  money?: boolean;
  suffix?: string;
};

type MetricList = {
  title: string;
  type: 'bars' | 'list';
  items: MetricItem[];
};

type MetricSection = {
  id: string;
  label: string;
  icon: string;
};

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

  sections: MetricSection[] = [
    { id: 'ventas', label: 'Ventas', icon: 'bar-chart-outline' },
    { id: 'forecast', label: 'Pronóstico', icon: 'trending-up-outline' },
    { id: 'inventory', label: 'Inventario', icon: 'cube-outline' },
    { id: 'contabilidad', label: 'Contabilidad', icon: 'wallet-outline' },
    { id: 'post-sales', label: 'Postventa', icon: 'construct-outline' },
  ];

  title = 'Ventas';
  heroLabel = 'Ventas del periodo';
  heroValue: number | string = 0;
  heroHint = 'Unidades · mes en curso';
  heroMoney = false;
  kpis: MetricItem[] = [];
  lists: MetricList[] = [];

  constructor(private api: ApiService) {}

  async ngOnInit() {
    await this.load();
  }

  async onSectionChange() {
    await this.load();
  }

  async load(event?: CustomEvent) {
    this.loading = !event;
    this.error = '';
    try {
      const data = await this.api.getMetricsSection(this.selectedSection);
      const hero = (data['hero'] || {}) as Record<string, unknown>;
      this.title = String(data['title'] || this.currentSectionLabel);
      this.heroLabel = String(hero['label'] || this.title);
      this.heroValue = Number(hero['value'] || 0);
      this.heroHint = String(hero['hint'] || '');
      this.heroMoney = Boolean(hero['money']);
      this.kpis = ((data['kpis'] || []) as MetricItem[]).map((item) => ({
        label: item.label,
        value: Number(item.value ?? item.count ?? 0),
        money: Boolean(item.money),
        suffix: item.suffix,
      }));
      this.lists = ((data['lists'] || []) as MetricList[]).map((list) => ({
        title: list.title,
        type: list.type === 'bars' ? 'bars' : 'list',
        items: (list.items || []).map((item) => ({
          label: item.label,
          count: Number(item.count ?? item.value ?? 0),
          money: Boolean(item.money),
          suffix: item.suffix,
        })),
      }));
    } catch {
      this.error = `No se pudieron cargar las métricas de ${this.currentSectionLabel.toLowerCase()}.`;
      this.kpis = [];
      this.lists = [];
    } finally {
      this.loading = false;
      event?.target && (event.target as HTMLIonRefresherElement).complete();
    }
  }

  get currentSectionLabel() {
    return this.sections.find((section) => section.id === this.selectedSection)?.label || 'Métricas';
  }

  barWidth(count: number, items: MetricItem[]) {
    const max = Math.max(...items.map((item) => Number(item.count || 0)), 1);
    return Math.round((Number(count || 0) / max) * 100);
  }

  formatValue(item: MetricItem) {
    const value = Number(item.value ?? item.count ?? 0);
    if (item.money) return this.formatMoney(value);
    if (item.suffix) return `${value.toLocaleString('es-MX')}${item.suffix}`;
    return value.toLocaleString('es-MX');
  }

  formatHeroValue() {
    const value = Number(this.heroValue || 0);
    return this.heroMoney ? this.formatMoney(value) : value.toLocaleString('es-MX');
  }

  formatMoney(n: number) {
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
    return `$${n.toFixed(0)}`;
  }
}
