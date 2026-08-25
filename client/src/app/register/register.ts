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
  
  // signals, not plain strings. the app is zoneless so angular only redraws when a signal changes,
  // and these get set inside the subscribe below, which is after the submit event has finished.
  errormessage = signal('');    // text shown on screen if login fails
  successmessage = signal('');  // text shown on screen if login works


  onSubmit() {              // called when the register form is submitted
    this.errormessage.set(''); // clear any message from a previous attempt
    this.successmessage.set('');

    this.auth.register(this.email, this.password).subscribe({ // send email+password to the backend
      next: () => {                     // runs if the backend responds with success
        this.successmessage.set('Registered successfully. You can now log in.');
        this.email = '';    // clear the form
        this.password = '';
      },
      error: (err: HttpErrorResponse) => {         // err.error is the JSON body the Express route sent, e.g. { error: 'Email is already registered' }
        this.errormessage.set(err.error?.error ?? 'Something went wrong, please try again.');
      },
    });
  }
}

