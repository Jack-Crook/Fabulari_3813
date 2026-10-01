import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { Auth } from '../auth';
import { emailProblem, passwordProblem, nameProblem, dobProblem, firstProblem } from '../validation';
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
  username = '';    // optional, defaults to the part before the @
  dob = '';         // optional, but needed to join an age limited group

  // signals, because they're set inside subscribe and the app is zoneless
  errormessage = signal('');
  successmessage = signal('');

  // stops a double click registering twice
  submitting = signal(false);


  onSubmit() {
    if (this.submitting()) {
      return;
    }
    this.errormessage.set('');
    this.successmessage.set('');

    // the same rules as the server, checked first so the user is told without a round trip
    const problem = firstProblem(
      emailProblem(this.email),
      nameProblem('Display name', this.username, false),
      dobProblem(this.dob),
      passwordProblem(this.password));
    if (problem) {
      this.errormessage.set(problem);
      return;
    }
    this.submitting.set(true);

    this.auth.register(this.email, this.password, this.username, this.dob).subscribe({
      next: res => {
        // the first account on an empty system becomes the super admin
        this.successmessage.set(res.role === 'super'
          ? 'Registered as the super admin. This was the first account on the system. You can now log in.'
          : 'Registered successfully. You can now log in.');
        this.email = '';
        this.password = '';
        this.username = '';
        this.dob = '';
        this.submitting.set(false);
      },
      error: (err: HttpErrorResponse) => {         // err.error is the server's { error } body
        this.errormessage.set(err.error?.error ?? 'Something went wrong, please try again.');
        this.submitting.set(false);
      },
    });
  }
}
