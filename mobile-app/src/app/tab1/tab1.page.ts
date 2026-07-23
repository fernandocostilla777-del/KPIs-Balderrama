import { Component, OnInit } from '@angular/core';
import { ApiService } from '../core/services/api.service';

@Component({
  selector: 'app-tab1',
  templateUrl: 'tab1.page.html',
  styleUrls: ['tab1.page.scss'],
  standalone: false,
})
export class Tab1Page implements OnInit {
  loading = true;
  error = '';
  ventasUnidades = 0;
  ventasIngreso = 0;
  ventasMargen = 0;
  inventarioUnidades = 0;
  inventarioValor = 0;
  servicioOrdenes = 0;
  servicioImporte = 0;
  coberturaPct = 0;
  sofiaNotificaciones = 0;
  sofiaObjetivo = 0;
  sofiaAvancePct = 0;

  constructor(private api: ApiService) {}

  async ngOnInit() {
    await this.load();
  }

  async load(event?: CustomEvent) {
    this.loading = !event;
    this.error = '';
    try {
      const data = await this.api.getOverview();
      const fin = (data['financial'] || {}) as Record<string, Record<string, number>>;
      const sales = fin['sales'] || {};
      const service = fin['service'] || {};
      const inv = fin['inventory'] || {};

      const kpis = (data['kpis'] || {}) as Record<string, number>;
      this.ventasUnidades = Number(sales['units'] || kpis['totalUnits'] || 0);
      this.ventasIngreso = Number(sales['revenue'] || 0);
      this.ventasMargen = Number(sales['marginPct'] || 0);
      this.inventarioUnidades = Number(inv['availableUnits'] || 0);
      this.inventarioValor = Number(inv['inventoryValue'] || 0);
      this.servicioOrdenes = Number(service['facturadas'] || 0);
      this.servicioImporte = Number(service['importeFacturado'] || 0);

      const sofia = (data['sofia'] || {}) as Record<string, number>;
      this.coberturaPct = Number(sofia['coberturaPct'] || 0);
      this.sofiaNotificaciones = Number(sofia['notificaciones'] || 0);
      this.sofiaObjetivo = Number(sofia['objetivo'] || 0);
      this.sofiaAvancePct = Number(sofia['avancePct'] || 0);
    } catch {
      this.error = 'No se pudo cargar el resumen. Verifica la URL del API en environment.ts';
    } finally {
      this.loading = false;
      event?.target && (event.target as HTMLIonRefresherElement).complete();
    }
  }

  formatMoney(n: number) {
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
    return `$${n.toFixed(0)}`;
  }

  get coberturaBarPct() {
    return Math.min(100, Math.max(0, this.coberturaPct));
  }

  get sofiaRingBackground() {
    const pct = Math.min(100, Math.max(0, this.sofiaAvancePct));
    return `conic-gradient(#e056fd 0 ${pct}%, rgba(255,255,255,.08) ${pct}% 100%)`;
  }

  get sofiaFaltantes() {
    return Math.max(0, this.sofiaObjetivo - this.sofiaNotificaciones);
  }

  get sofiaObjetivoLabel() {
    return this.sofiaObjetivo > 0 ? this.sofiaObjetivo.toLocaleString('es-MX') : '—';
  }

  get sofiaFaltantesLabel() {
    return this.sofiaObjetivo > 0 ? this.sofiaFaltantes.toLocaleString('es-MX') : '—';
  }
}
