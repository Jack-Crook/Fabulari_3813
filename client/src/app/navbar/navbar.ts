import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, Router } from '@angular/router';
import { Auth } from '../auth';

@Component({
  selector: 'app-navbar',
  imports: [RouterLink, RouterLinkActive],
  templateUrl: './navbar.html',
  styleUrl: './navbar.css',
})


export class Navbar {
  private auth = inject(Auth);
  private router = inject(Router);

  onLogout() {                          // runs when the logout button is clicked
    this.auth.logout();                 // clear the stored user first
    this.router.navigateByUrl('/login');// then send them back to the login page
  }
}
