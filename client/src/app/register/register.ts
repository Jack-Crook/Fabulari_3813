import { Component, inject } from '@angular/core';
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
  errorMessage = '';    // shown in the template when the request fails
  successMessage = '';  // shown in the template when the request succeeds

  onSubmit() {              // called when the register form is submitted
    this.errorMessage = ''; // clear any message from a previous attempt
    this.successMessage = '';

    this.auth.register(this.email, this.password).subscribe({ // send email+password to the backend
      next: () => {                     // runs if the backend responds with success
        this.successMessage = 'Registered successfully. You can now log in.';
        this.email = '';    // clear the form
        this.password = '';
      },
      error: (err: HttpErrorResponse) => {         // err.error is the JSON body the Express route sent, e.g. { error: 'Email is already registered' }
        this.errorMessage = err.error?.error ?? 'Something went wrong, please try again.';
      },
    });
  }
}

