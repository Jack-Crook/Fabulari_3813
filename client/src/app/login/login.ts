import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';       // [(ngModel)]
import { RouterLink, Router } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { Auth, LoginResponse } from '../auth';
import { firstProblem } from '../validation';


@Component({
  selector: 'app-login',
  imports: [FormsModule, RouterLink],
  templateUrl: './login.html',
})
export class Login {
  private auth = inject(Auth);
  private router = inject(Router);
  email = '';           
  password = '';        

  // signals, because they're set inside subscribe and the app is zoneless
  errormessage = signal('');
  successmessage = signal('');


  // disables the button during a login, so a double click can't send two
  submitting = signal(false);


  onSubmit() {
    if (this.submitting()) {
      return;
    }
    this.errormessage.set('');
    this.successmessage.set('');

    // only "is it filled in" here: the format is checked at register, and an older account may not match it
    const problem = firstProblem(
      this.email.trim() ? null : 'Email is required',
      this.password ? null : 'Password is required');
    if (problem) {
      this.errormessage.set(problem);
      return;
    }
    this.submitting.set(true);

    this.auth.login(this.email, this.password).subscribe({
            next: (res: LoginResponse) => {

        // keep only what the navbar and guards need, the rest is fetched fresh
        this.auth.saveUser({ email: res.email, role: res.role, username: res.username, avatarUrl: res.avatarUrl });
        this.successmessage.set('Logged in successfully.');


        // everyone lands on the same dashboard, the navbar offers the admin pages.
        // the 1s delay lets the message be read.
        setTimeout(() => this.router.navigateByUrl('/user-dashboard'), 1000);
      },

      error: (err: HttpErrorResponse) => {

        this.errormessage.set(err.error?.error ?? 'Something went wrong, please try again.');
        this.submitting.set(false);      // allow another try
      },

    });
  }
}