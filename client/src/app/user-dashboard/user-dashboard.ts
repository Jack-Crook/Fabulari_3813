import { Component } from '@angular/core';
import { Navbar } from '../navbar/navbar'

@Component({
  selector: 'app-user-dashboard',
  imports: [Navbar],
  templateUrl: './user-dashboard.html',
  styleUrl: './user-dashboard.css',
})
export class UserDashboard {}
