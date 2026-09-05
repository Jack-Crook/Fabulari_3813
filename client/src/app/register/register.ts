import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { Auth } from '../auth';
import { RouterLink } from '@angular/router';


@Component({
  selector: 'app-register',
  imports: [FormsModule, RouterLink],
  templateUrl: './register.html',
  styleUrl: './register.css',
})

export class Register {
  private auth = inject(Auth);

  email = '';
  password = '';
  username = '';    // optional, the server falls back to the part before the @ when it's blank
  dob = '';         // optional here, but needed before joining a group with an age limit

  // signals, not plain strings. the app is zoneless so angular only redraws when a signal changes,
  // and these get set inside the subscribe below, which is after the submit event has finished.
  errormessage = signal('');    // text shown on screen if login fails
  successmessage = signal('');  // text shown on screen if login works

  // stops a double click sending two registrations, same reason as the login page
  submitting = signal(false);


  onSubmit() {              // called when the register form is submitted
    if (this.submitting()) {
      return;
    }
    this.submitting.set(true);
    this.errormessage.set(''); // clear any message from a previous attempt
    this.successmessage.set('');

    this.auth.register(this.email, this.password, this.username, this.dob).subscribe({ // send the form to the backend
      next: res => {                    // runs if the backend responds with success
        // the spec says exactly one super admin exists and nobody can create that account.
        // rather than editing users.json by hand, the very first account to register on an
        // empty system becomes it, and the server sends the role back so this page can say so.
        this.successmessage.set(res.role === 'super'
          ? 'Registered as the super admin — this was the first account on the system. You can now log in.'
          : 'Registered successfully. You can now log in.');
        this.email = '';    // clear the form
        this.password = '';
        this.username = '';
        this.dob = '';
        this.submitting.set(false);
      },
      error: (err: HttpErrorResponse) => {         // err.error is the JSON body the Express route sent, e.g. { error: 'Email is already registered' }
        this.errormessage.set(err.error?.error ?? 'Something went wrong, please try again.');
        this.submitting.set(false);
      },
    });
  }
}
