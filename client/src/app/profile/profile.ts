import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';   // lets the html use routerLink
import { Navbar } from '../navbar/navbar';

@Component({
  selector: 'app-profile',
  imports: [Navbar, RouterLink],
  templateUrl: './profile.html',
  styleUrl: './profile.css',
})
export class Profile {
  // hardcoded for now, swap these for the logged in user later
  username = 'User_name';
  email = 'user@example.com';
  role = 'User';
  groups = 3;
}
