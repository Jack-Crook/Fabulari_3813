import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';

import { Register } from './register';
import { testProviders } from '../testing';

describe('Register', () => {
  let component: Register;
  let fixture: ComponentFixture<Register>;
  let mock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Register],
      providers: testProviders(),
    }).compileComponents();

    fixture = TestBed.createComponent(Register);
    component = fixture.componentInstance;
    mock = TestBed.inject(HttpTestingController);
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('clears the form and confirms an ordinary signup', () => {
    component.email = 'new@test.com';
    component.password = 'pw1234';
    component.onSubmit();

    mock.expectOne('http://localhost:3000/register')
      .flush({ message: 'ok', email: 'new@test.com', role: 'user' });

    expect(component.successmessage()).toContain('Registered successfully');
    expect(component.email).toBe('');
  });

  it('says so when the first account on the system becomes the super admin', () => {
    component.onSubmit();

    // the bootstrap rule: exactly one super admin must exist and nobody can create that
    // account, so the very first registration on an empty users.json becomes it. the server
    // sends the role back, which is how this page knows.
    mock.expectOne('http://localhost:3000/register')
      .flush({ message: 'ok', email: 'first@test.com', role: 'super' });

    expect(component.successmessage()).toContain('super admin');
  });

  it('shows the server\'s message when the email is already taken', () => {
    component.onSubmit();

    mock.expectOne('http://localhost:3000/register')
      .flush({ error: 'Email is already registered' }, { status: 409, statusText: 'Conflict' });

    expect(component.errormessage()).toBe('Email is already registered');
  });

  it('shows the server\'s message when the email is permanently banned', () => {
    component.onSubmit();

    // a system wide ban is permanent — the account is deleted and the email blacklisted, so
    // registering again with it is refused rather than silently creating a new account
    mock.expectOne('http://localhost:3000/register').flush(
      { error: 'This email is permanently banned and cannot be reused' },
      { status: 403, statusText: 'Forbidden' });

    expect(component.errormessage()).toContain('permanently banned');
  });
});
