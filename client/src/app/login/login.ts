import { Component, inject } from '@angular/core';
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
  errormessage = '';    // text shown on screen if login fails
  successmessage = '';  // text shown on screen if login works

  onSubmit() {                // runs when the login form is submitted
    this.errormessage = '';   // clear old messages first
    this.successmessage = '';

    this.auth.login(this.email, this.password).subscribe({ // send email+password to the backend
            next: (res: LoginResponse) => {

        // this runs if the backend says login worked
        this.auth.saveUser(res.email, res.role);      // remember who logged in before leaving this page
        this.successmessage = 'Logged in successfully.';


        // the super admin gets their own dashboard, everyone else starts on the normal user one
        const target = res.role === 'super' ? '/super-admin-dashboard' : '/user-dashboard';
        setTimeout(() => this.router.navigateByUrl(target), 1000);
      },

      error: (err: HttpErrorResponse) => {
        
        // this runs if the backend says login failed (wrong password etc)
        this.errormessage = err.error?.error ?? 'Something went wrong, please try again.';
      },

    });
  }
}