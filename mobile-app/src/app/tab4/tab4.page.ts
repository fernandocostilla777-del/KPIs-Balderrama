import { Component, OnInit } from '@angular/core';
import { ApiService } from '../core/services/api.service';

type SeguimientoKpi = {
  label: string;
  value: number;
};

type ConversionItem = {
  label: string;
  count: number;
  suffix?: string;
};

@Component({
  selector: 'app-tab4',
  templateUrl: 'tab4.page.html',
  styleUrls: ['tab4.page.scss'],
  standalone: false,
})
export class Tab4Page implements OnInit {
  loading = true;
  error = '';
  leads = 0;
  kpis: SeguimientoKpi[] = [];
  conversiones: ConversionItem[] = [];
  pvas: ConversionItem[] = [];
  syncedAt: Date | null = null;

  constructor(private api: ApiService) {}

  async ngOnInit() {
    await this.load();
  }

  async load(event?: CustomEvent) {
    this.loading = !event;
    this.error = '';
    try {
      const data = await this.api.getMetricsSection('seguimiento');
      const hero = (data['hero'] || {}) as Record<string, unknown>;
      this.leads = Number(hero['value'] || 0);
      this.kpis = ((data['kpis'] || []) as Array<Record<string, unknown>>).map((item) => ({
        label: String(item['label'] || '—'),
        value: Number(item['value'] || 0),
      }));

      const lists = (data['lists'] || []) as Array<Record<string, unknown>>;
      const conversions = lists.find((list) => list['title'] === 'Conversiones');
      this.conversiones = ((conversions?.['items'] || []) as Array<Record<string, unknown>>).map((item) => ({
        label: String(item['label'] || '—'),
        count: Number(item['count'] || 0),
        suffix: item['suffix'] ? String(item['suffix']) : undefined,
      }));
      const pvaList = lists.find((list) => list['title'] === 'Productos de valor agregado');
      this.pvas = ((pvaList?.['items'] || []) as Array<Record<string, unknown>>).map((item) => ({
        label: String(item['label'] || '—'),
        count: Number(item['count'] || 0),
      }));

      const cloud = (data['cloud'] || {}) as Record<string, unknown>;
      this.syncedAt = cloud['syncedAt'] ? new Date(String(cloud['syncedAt'])) : null;
    } catch {
      this.error = 'No se pudo actualizar Seguimiento 360.';
    } finally {
      this.loading = false;
      event?.target && (event.target as HTMLIonRefresherElement).complete();
    }
  }

  conversionWidth(item: ConversionItem) {
    return item.suffix === '%' ? Math.min(100, Math.max(0, item.count)) : 0;
  }

  formatConversion(item: ConversionItem) {
    return `${item.count.toLocaleString('es-MX')}${item.suffix || ''}`;
  }
}
