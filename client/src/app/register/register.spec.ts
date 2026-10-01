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
    component.email = 'first@test.com';
    component.password = 'pw1234';
    component.onSubmit();

    // the first account on an empty system becomes the super admin, and the server says so
    mock.expectOne('http://localhost:3000/register')
      .flush({ message: 'ok', email: 'first@test.com', role: 'super' });

    expect(component.successmessage()).toContain('super admin');
  });

  it('shows the server\'s message when the email is already taken', () => {
    component.email = 'first@test.com';
    component.password = 'pw1234';
    component.onSubmit();

    mock.expectOne('http://localhost:3000/register')
      .flush({ error: 'Email is already registered' }, { status: 409, statusText: 'Conflict' });

    expect(component.errormessage()).toBe('Email is already registered');
  });

  it('shows the server\'s message when the email is permanently banned', () => {
    component.email = 'first@test.com';
    component.password = 'pw1234';
    component.onSubmit();

    // a banned email can never register again
    mock.expectOne('http://localhost:3000/register').flush(
      { error: 'This email is permanently banned and cannot be reused' },
      { status: 403, statusText: 'Forbidden' });

    expect(component.errormessage()).toContain('permanently banned');
  });

  it('checks the form before sending: email format, password length and a future date of birth', () => {
    component.email = 'not-an-email';
    component.password = 'pw1234';
    component.onSubmit();
    expect(component.errormessage()).toBe('That is not a valid email address');

    component.email = 'new@test.com';
    component.password = '123';
    component.onSubmit();
    expect(component.errormessage()).toBe('Password must be at least 6 characters');

    component.password = 'pw1234';
    component.dob = '2999-01-01';
    component.onSubmit();
    expect(component.errormessage()).toContain('future');

    // none of them reached the server
    mock.expectNone('http://localhost:3000/register');
  });
});
