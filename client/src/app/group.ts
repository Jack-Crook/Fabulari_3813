import { Service, inject } from '@angular/core';    // Service = injectable decorator; inject() = grabs a dependency
import { HttpClient } from '@angular/common/http';  // lets this service make HTTP requests

// the shape the express /groups routes send back, one document in the groups collection
export interface Group {
  _id: string;                // mongo generates this, it arrives as a 24 character hex string
  name: string;
  description: string;
  ageLimit: number;
  theme: string;              // hex colour, the group picks it and it carries into its chat rooms
  adminEmails: string[];
  memberEmails: string[];
  bannedEmails: string[];     // group level bans. the account still exists, they just can't be in this group
}

// one document in the channels collection. a channel is a room inside a group
export interface Channel {
  _id: string;                // mongo generates this, it arrives as a 24 character hex string
  groupId: string;
  name: string;
}

// one member as GET /groups/:id/members sends them: only what the chat room shows next to a
// message. profiles are private, so nothing else about them comes with it.
export interface GroupMember {
  email: string;
  username: string;
  avatarUrl: string;    // '' when they haven't uploaded a picture
}

// PATCH /groups/:id sends back the saved group plus anyone the change removed, because raising
// the age limit boots members who no longer meet it and the admin should be told who went.
export interface GroupEditResponse {
  group: Group;
  booted: string[];
}

// the fields a group admin can change without asking anyone. the spec is explicit that only
// creating and deleting a group need the super admin, and editing one doesn't.
export interface GroupChanges {
  name?: string;
  description?: string;
  ageLimit?: number;
  theme?: string;
}

@Service()          // same as Auth, marks this class injectable app-wide
export class GroupService {
  private http = inject(HttpClient);
  private apiUrl = 'http://localhost:3000';

  getGroups() {                     // GET /groups, every group in the system
    return this.http.get<Group[]>(`${this.apiUrl}/groups`);
  }

  getChannels(groupId: string) {    // GET /channels?groupId=g1, just the rooms inside one group
    return this.http.get<Channel[]>(`${this.apiUrl}/channels`, { params: { groupId } });
  }

  // GET /groups/:id/members, the name and picture for everyone in the group, for the chat room
  getMembers(groupId: string) {
    return this.http.get<GroupMember[]>(`${this.apiUrl}/groups/${groupId}/members`);
  }

  // PATCH /groups/:id. actorEmail goes in the body so the server can check the caller really is
  // an admin of this group rather than taking the client's word for it.
  updateGroup(groupId: string, changes: GroupChanges, actorEmail: string) {
    return this.http.patch<GroupEditResponse>(`${this.apiUrl}/groups/${groupId}`, { ...changes, actorEmail });
  }

  // POST /groups/:id/members, the signed in user joins a group. actorEmail has to match email,
  // because you can only join a group yourself. the server auto rejects with a 403 when the user
  // is under the group's age limit, or has been banned from this group.
  joinGroup(groupId: string, email: string) {
    return this.http.post<Group>(`${this.apiUrl}/groups/${groupId}/members`, { email, actorEmail: email });
  }

  // DELETE /groups/:id/members/:email. this is the group level removal, the account itself
  // still exists. the server answers 409 if removing them would leave the group with no admin.
  // the email is encoded because it goes in the url rather than the body, and characters like
  // + and # would otherwise change what the path means.
  removeMember(groupId: string, email: string, actorEmail: string) {
    return this.http.delete<Group>(
      `${this.apiUrl}/groups/${groupId}/members/${encodeURIComponent(email)}`,
      { params: { actorEmail } });
  }

  // POST /groups/:id/bans. stronger than removeMember, because it also stops them rejoining. still
  // group level though, so unlike a system wide ban it can be lifted again below.
  banFromGroup(groupId: string, email: string, reason: string, actorEmail: string) {
    return this.http.post<Group>(`${this.apiUrl}/groups/${groupId}/bans`, { email, reason, actorEmail });
  }

  liftGroupBan(groupId: string, email: string, actorEmail: string) {
    return this.http.delete<Group>(
      `${this.apiUrl}/groups/${groupId}/bans/${encodeURIComponent(email)}`,
      { params: { actorEmail } });
  }

  // POST /groups/:id/admins. a group admin can promote any member of that group, and there's
  // no limit on how many admins a group has.
  promoteAdmin(groupId: string, email: string, actorEmail: string) {
    return this.http.post<Group>(`${this.apiUrl}/groups/${groupId}/admins`, { email, actorEmail });
  }

  // DELETE /groups/:id/admins/:email. the same call whether an admin is demoting someone else
  // or stepping down themself, and the server refuses either way if they're the last admin left.
  demoteAdmin(groupId: string, email: string, actorEmail: string) {
    return this.http.delete<Group>(
      `${this.apiUrl}/groups/${groupId}/admins/${encodeURIComponent(email)}`,
      { params: { actorEmail } });
  }

  createChannel(groupId: string, name: string, actorEmail: string) {    // POST /channels, a new room inside a group
    return this.http.post<Channel>(`${this.apiUrl}/channels`, { groupId, name, actorEmail });
  }

  renameChannel(channelId: string, name: string, actorEmail: string) {  // PATCH /channels/:id, for fixing a typo in a room name
    return this.http.patch<Channel>(`${this.apiUrl}/channels/${channelId}`, { name, actorEmail });
  }

  deleteChannel(channelId: string, actorEmail: string) {                // DELETE /channels/:id
    return this.http.delete<{ message: string }>(
      `${this.apiUrl}/channels/${channelId}`, { params: { actorEmail } });
  }
}
