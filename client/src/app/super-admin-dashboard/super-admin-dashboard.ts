import { Component } from '@angular/core';
import { Navbar } from '../navbar/navbar';

@Component({
  selector: 'app-super-admin-dashboard',
  imports: [Navbar],
  templateUrl: './super-admin-dashboard.html',
  styleUrl: './super-admin-dashboard.css',
})
export class SuperAdminDashboard {
  // requests aren't stored anywhere yet, there's no /requests endpoint, so these stay mock —
  // same reason admin-dashboard's joinRequests is mock
  pendingRequests = [
    { detail: "Create new room 'Room Name'", requestedBy: 'jo23' },
    { detail: 'Ban user Bully123', requestedBy: 'John89' },
  ];

  // no /users endpoint yet, so this is a static stand-in for "every registered user"
  members = [
    { email: 'jo23' },
    { email: 'sam99' },
    { email: 'newuser@example.com' },
  ];

  // permanent, so unlike the wireframe's "Un Ban" button there's nothing to click here
  bannedUsers = [
    { email: 'bully34', reason: 'Swearing', bannedAt: '2026-08-13' },
  ];

  // no /audit endpoint yet, mock rows matching the columns from the wireframe
  auditLog = [
    { date: '2026-08-20', type: 'Group Created', actor: 'test@test.com', detail: 'Created group "Book Club"' },
  ];
}