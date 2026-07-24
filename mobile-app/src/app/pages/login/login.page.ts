import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-login',
  templateUrl: './login.page.html',
  styleUrls: ['./login.page.scss'],
  standalone: false,
})
export class LoginPage {
  username = '';
  password = '';
  loading = false;
  error = '';

  constructor(
    private auth: AuthService,
    private router: Router,
  ) {}

  async submit() {
    this.error = '';
    this.loading = true;
    try {
      await this.auth.login(this.username.trim(), this.password);
      const home = this.auth.session?.homePath || '/tabs/dashboard';
      await this.router.navigateByUrl(home, { replaceUrl: true });
    } catch (err: unknown) {
      const httpErr = err as { status?: number; error?: { error?: string }; message?: string };
      if (httpErr?.status === 0 || /Failed to fetch|NetworkError|CORS/i.test(String(httpErr?.message || ''))) {
        this.error = 'No hay conexión con Cloud API (revisa CORS o la URL).';
      } else if (httpErr?.status === 401) {
        this.error = 'Usuario o contraseña incorrectos.';
      } else {
        this.error = httpErr?.error?.error || 'No se pudo iniciar sesión. Intenta de nuevo.';
      }
    } finally {
      this.loading = false;
    }
  }
}
