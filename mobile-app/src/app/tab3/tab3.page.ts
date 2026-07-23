import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService, SessionUser } from '../core/services/auth.service';
import { environment } from '../../environments/environment';

@Component({
  selector: 'app-tab3',
  templateUrl: 'tab3.page.html',
  styleUrls: ['tab3.page.scss'],
  standalone: false,
})
export class Tab3Page implements OnInit {
  user: SessionUser | null = null;
  apiUrl = environment.apiUrl;

  constructor(
    private auth: AuthService,
    private router: Router,
  ) {}

  ngOnInit() {
    this.auth.session$.subscribe((s) => { this.user = s; });
    if (!this.user) this.auth.ensureSession();
  }

  async logout() {
    await this.auth.logout();
    await this.router.navigateByUrl('/login', { replaceUrl: true });
  }
}
