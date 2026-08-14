import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { Auth } from '../auth';

@Component({
  selector: 'app-login',
  imports: [],
  templateUrl: './login.html',
  styleUrl: './login.css',
})
export class Login {
  private auth = inject(Auth);

  email = '';
  password = '';
  errormessage = '';
  successmessage = '';

  onSubmit() {
    this.errormessage = '';
    this.successmessage = '';

    this.auth.login(this.email, this.password).subscribe({
      next: () => {
        this.successmessage = 'Logged in successfully.';
      },
    });
  }

}
