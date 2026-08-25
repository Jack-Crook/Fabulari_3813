import { Component } from '@angular/core';
import { Navbar } from '../navbar/navbar';

@Component({
  selector: 'app-admin-dashboard',
  imports: [Navbar],
  templateUrl: './admin-dashboard.html',
  styleUrl: './admin-dashboard.css',
})
export class AdminDashboard {
  // all mock data for now. phase 1 allows mock data, so this is here to get the layout
  // matching the wireframe before it's swapped for real calls to /groups and /channels.
  group = {
    name: 'Book Club',
    ageLimit: 16,
  };

  // joinDate and lastLogin aren't stored on a user yet, they're only here because the
  // wireframe shows those columns. they need adding to the user shape before this is real.
  members = [
    { name: 'test@test.com', role: 'Admin',  joinDate: '12/07/2026', lastLogin: '25/08/2026' },
    { name: 'jack@123',      role: 'Member', joinDate: '14/07/2026', lastLogin: '24/08/2026' },
    { name: 'hello@hello.com', role: 'Member', joinDate: '20/08/2026', lastLogin: '25/08/2026' },
  ];

  // users asking to join this group. the group admin approves or rejects them.
  joinRequests = [
    { email: 'newperson@example.com' },
    { email: 'someone@example.com' },
    { email: 'third@example.com' },
  ];
}
