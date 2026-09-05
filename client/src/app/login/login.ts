import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';       // lets the html use [(ngModel)] on the inputs
import { RouterLink, Router } from '@angular/router';        // lets the html use routerLink
import { HttpErrorResponse } from '@angular/common/http'; // the type of error http requests give back
import { Auth, LoginResponse } from '../auth';                      // the service that actually talks to the backend


@Component({
  selector: 'app-login',
  imports: [FormsModule, RouterLink],
  templateUrl: './login.html',
  styleUrl: './login.css',
})
export class Login {
  private auth = inject(Auth); // grabs the Auth service so this component can use it //stores email or password typed in
  private router = inject(Router);
  email = '';           
  password = '';        

  // signals, not plain strings. the app is zoneless so angular only redraws when a signal changes,
  // and these get set inside the subscribe below, which is after the submit event has finished.
  errormessage = signal('');    // text shown on screen if login fails
  successmessage = signal('');  // text shown on screen if login works


  // disables the button while a login is in flight. without it a double click fires two
  // requests and two setTimeout redirects.
  submitting = signal(false);


  onSubmit() {                // runs when the login form is submitted
    if (this.submitting()) {
      return;
    }
    this.submitting.set(true);
    this.errormessage.set('');   // clear old messages first
    this.successmessage.set('');

    this.auth.login(this.email, this.password).subscribe({ // send email+password to the backend
            next: (res: LoginResponse) => {

        // this runs if the backend says login worked
        // only the three fields the navbar and the guards need are kept. everything else about
        // the account is fetched fresh by the profile page, because localStorage goes stale the
        // moment the profile is edited.
        this.auth.saveUser({ email: res.email, role: res.role, username: res.username });
        this.successmessage.set('Logged in successfully.');


        // everyone lands on the same dashboard whatever their role, the navbar is what offers
        // the super admin / group admin pages. the 1s delay lets the success message be read
        // before the page changes.
        setTimeout(() => this.router.navigateByUrl('/user-dashboard'), 1000);
      },

      error: (err: HttpErrorResponse) => {

        // this runs if the backend says login failed (wrong password etc)
        this.errormessage.set(err.error?.error ?? 'Something went wrong, please try again.');
        this.submitting.set(false);      // let them try again, the button is disabled until this clears
      },

    });
  }
}