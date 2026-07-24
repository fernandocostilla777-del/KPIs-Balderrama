import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../core/services/auth.service';

@Component({
  selector: 'app-tabs',
  templateUrl: 'tabs.page.html',
  styleUrls: ['tabs.page.scss'],
  standalone: false,
})
export class TabsPage implements OnInit {
  pages = new Set<string>();

  constructor(
    private auth: AuthService,
    private router: Router,
  ) {}

  ngOnInit() {
    this.refresh();
    this.auth.session$.subscribe(() => {
      this.refresh();
      this.ensureAllowedTab();
    });
    this.ensureAllowedTab();
  }

  can(page: string) {
    return this.pages.has(page);
  }

  private refresh() {
    const list = this.auth.session?.pages || ['dashboard', 'metrics', 'profile'];
    this.pages = new Set(list);
  }

  private ensureAllowedTab() {
    const url = this.router.url || '';
    const map: Array<[string, string]> = [
      ['/tabs/dashboard', 'dashboard'],
      ['/tabs/metrics', 'metrics'],
      ['/tabs/seguimiento', 'seguimiento'],
      ['/tabs/assistant', 'assistant'],
      ['/tabs/profile', 'profile'],
    ];
    const hit = map.find(([path]) => url.startsWith(path));
    if (hit && !this.can(hit[1])) {
      const home = this.auth.session?.homePath || '/tabs/metrics';
      void this.router.navigateByUrl(home, { replaceUrl: true });
    }
  }
}
