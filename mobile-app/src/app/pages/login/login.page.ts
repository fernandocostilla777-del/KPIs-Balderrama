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
    } catch {
      this.error = 'Usuario o contraseña incorrectos.';
    } finally {
      this.loading = false;
    }
  }
}
