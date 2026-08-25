import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Navbar } from '../navbar/navbar';
import { GroupService, Group } from '../group';

@Component({
  selector: 'app-admin-dashboard',
  imports: [Navbar],
  templateUrl: './admin-dashboard.html',
  styleUrl: './admin-dashboard.css',
})
export class AdminDashboard {
  private groupService = inject(GroupService);
  private route = inject(ActivatedRoute);

  group = signal<Group | undefined>(undefined);   // the group whose id is in the url

  // join requests aren't stored anywhere, there's no requests endpoint yet, so these stay mock
  joinRequests = [
    { email: 'newperson@example.com' },
    { email: 'someone@example.com' },
    { email: 'third@example.com' },
  ];

  constructor() {
    // subscribed rather than read once, so switching between two groups you admin reloads
    this.route.paramMap.subscribe(params => {
      const groupId = params.get('groupId') ?? '';

      this.groupService.getGroups().subscribe(groups => {
        this.group.set(groups.find(g => g.id === groupId));
      });
    });
  }

  // admins are just the members whose email is in adminEmails, there's no role stored per member
  roleOf(email: string) {
    return this.group()?.adminEmails.includes(email) ? 'Admin' : 'Member';
  }
}
