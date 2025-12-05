import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Model } from 'mongoose';
import { UsersService } from './users.service';
import { UserDocument } from './schemas/user.schema';

type ExecResult<T> = { exec: jest.Mock<Promise<T>, []> };

class MockUserModel {
  static findOne = jest.fn();
  static find = jest.fn();
  static countDocuments = jest.fn();
  static findById = jest.fn();
  static findByIdAndUpdate = jest.fn();
  static findByIdAndDelete = jest.fn();
  static saveImplementation = jest.fn();

  constructor(private readonly payload: Record<string, any>) {}

  save() {
    return MockUserModel.saveImplementation(this.payload);
  }
}

const createQuery = <T>(value: T): ExecResult<T> => ({ exec: jest.fn().mockResolvedValue(value) });

const createLeanQuery = (value: any[]) => ({
  sort: jest.fn().mockReturnThis(),
  skip: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  lean: jest.fn().mockReturnThis(),
  exec: jest.fn().mockResolvedValue(value),
});

describe('UsersService', () => {
  let service: UsersService;
  let mockModel: typeof MockUserModel;

  beforeEach(() => {
    mockModel = MockUserModel;
    mockModel.findOne = jest.fn();
    mockModel.find = jest.fn();
    mockModel.countDocuments = jest.fn();
    mockModel.findById = jest.fn();
    mockModel.findByIdAndUpdate = jest.fn();
    mockModel.findByIdAndDelete = jest.fn();
    mockModel.saveImplementation = jest.fn();

    service = new UsersService(mockModel as unknown as Model<UserDocument>);
  });

  it('cria usuário e retorna versão sanitizada', async () => {
    const toObject = jest.fn().mockReturnValue({
      _id: 'mock-id',
      name: 'Tester',
      email: 'tester@example.com',
      __v: 0,
    });
    const savedDoc = {
      _id: 'mock-id',
      name: 'Tester',
      email: 'tester@example.com',
      password: 'hashed',
      toObject,
    };

    mockModel.findOne.mockReturnValue(createQuery(null));
    mockModel.saveImplementation.mockResolvedValue(savedDoc);

    const result = await service.create({
      name: 'Tester',
      email: 'Tester@example.com',
      password: 'secret',
    });

    expect(mockModel.findOne).toHaveBeenCalledWith({ email: 'tester@example.com' });
    expect(result).toEqual({ id: 'mock-id', name: 'Tester', email: 'tester@example.com' });
    expect(result).not.toHaveProperty('password');
    expect(toObject).toHaveBeenCalled();
  });

  it('rejeita criação quando o e-mail já existe', async () => {
    mockModel.findOne.mockReturnValue(createQuery({ email: 'exists@example.com' }));

    await expect(
      service.create({
        name: 'Rebel',
        email: 'exists@example.com',
        password: 'secret',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('lista usuários paginados e sanitizados', async () => {
    const rawDoc = {
      _id: 'page-id',
      name: 'Pager',
      email: 'pager@example.com',
      password: 'hash',
      createdAt: new Date(),
      toObject: jest.fn().mockReturnValue({
        _id: 'page-id',
        name: 'Pager',
        email: 'pager@example.com',
      }),
    };

    mockModel.find.mockReturnValue(createLeanQuery([rawDoc]));
    mockModel.countDocuments.mockReturnValue(createQuery(42));

    const result = await service.findAll(2, 10);

    expect(result.total).toBe(42);
    expect(result.items).toEqual([
      { id: 'page-id', name: 'Pager', email: 'pager@example.com' },
    ]);
    expect((mockModel.find as jest.Mock).mock.calls[0][0]).toBeUndefined();
  });

  it('atualiza usuário com e-mail normalizado e senha criptografada', async () => {
    const updatedDoc = {
      _id: 'upd-id',
      name: 'Updated',
      email: 'updated@example.com',
      password: 'hashed',
      toObject: jest.fn().mockReturnValue({
        _id: 'upd-id',
        name: 'Updated',
        email: 'updated@example.com',
      }),
    };
    mockModel.findByIdAndUpdate.mockReturnValue(createQuery(updatedDoc));

    const result = await service.update('upd-id', {
      email: 'Updated@Example.com',
      name: 'Updated',
      password: 'newpass',
    });

    const updateArgs = (mockModel.findByIdAndUpdate as jest.Mock).mock.calls[0];
    expect(updateArgs[0]).toBe('upd-id');
    expect(updateArgs[1].email).toBe('updated@example.com');
    expect(updateArgs[1].password).not.toBe('newpass');
    expect(result).toEqual({ id: 'upd-id', name: 'Updated', email: 'updated@example.com' });
  });

  it('remove usuário existente e retorna sanitizado', async () => {
    const deletedDoc = {
      _id: 'del-id',
      name: 'Gone',
      email: 'gone@example.com',
      password: 'hash',
      toObject: jest.fn().mockReturnValue({
        _id: 'del-id',
        name: 'Gone',
        email: 'gone@example.com',
      }),
    };
    mockModel.findByIdAndDelete.mockReturnValue(createQuery(deletedDoc));

    const result = await service.remove('del-id');

    expect(result).toEqual({ id: 'del-id', name: 'Gone', email: 'gone@example.com' });
  });

  it('dispara NotFoundException ao remover usuário inexistente', async () => {
    mockModel.findByIdAndDelete.mockReturnValue(createQuery(null));

    await expect(service.remove('missing')).rejects.toBeInstanceOf(NotFoundException);
  });
});
