import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import * as bcrypt from 'bcrypt';
import { Model } from 'mongoose';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { User, UserDocument } from './schemas/user.schema';

export type SafeUser = {
  id: string;
  name: string;
  email: string;
  isAdmin: boolean;
  createdAt?: Date;
  updatedAt?: Date;
};

@Injectable()
export class UsersService implements OnModuleInit {
  private readonly defaultEmail =
    process.env.DEFAULT_ADMIN_EMAIL ?? 'admin@example.com';
  private readonly defaultPassword =
    process.env.DEFAULT_ADMIN_PASSWORD ?? '123456';

  constructor(
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
  ) {}

  async onModuleInit() {
    await this.ensureDefaultAdmin();
  }

  async ensureDefaultAdmin() {
    const existing = await this.userModel
      .findOne({ email: this.defaultEmail.toLowerCase() })
      .exec();
    if (existing) {
      if (!existing.isAdmin) {
        existing.isAdmin = true;
        await existing.save();
      }
      return;
    }

    await this.create({
      name: 'GDASH Admin',
      email: this.defaultEmail,
      password: this.defaultPassword,
      isAdmin: true,
    });
  }

  async create(createDto: CreateUserDto): Promise<SafeUser> {
    const normalizedEmail = createDto.email.toLowerCase();
    const exists = await this.userModel
      .findOne({ email: normalizedEmail })
      .exec();
    if (exists) {
      throw new BadRequestException('User already exists');
    }

    const hashed = await bcrypt.hash(createDto.password, 10);
    const created = new this.userModel({
      ...createDto,
      email: normalizedEmail,
      password: hashed,
      isAdmin: Boolean(createDto.isAdmin),
    });

    try {
      const user = await created.save();
      return this.sanitize(user);
    } catch (error) {
      throw new InternalServerErrorException('Unable to create user');
    }
  }

  async findAll(page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [items, total] = await Promise.all([
      this.userModel
        .find()
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
      this.userModel.countDocuments().exec(),
    ]);

    return {
      total,
      items: items.map((doc) => this.sanitize(doc)),
    };
  }

  async findById(id: string): Promise<SafeUser | null> {
    const user = await this.userModel.findById(id).exec();
    return user ? this.sanitize(user) : null;
  }

  async findEntityById(id: string): Promise<UserDocument | null> {
    return this.userModel.findById(id).exec();
  }

  async findEntityByEmail(email: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ email: email.toLowerCase() }).exec();
  }

  async update(id: string, updateDto: UpdateUserDto): Promise<SafeUser> {
    const updates: Partial<User> = { ...updateDto };
    if (updates.email) {
      updates.email = updates.email.toLowerCase();
    }

    if (updateDto.password) {
      updates.password = await bcrypt.hash(updateDto.password, 10);
    }

    if (updateDto.isAdmin !== undefined) {
      updates.isAdmin = updateDto.isAdmin;
    }

    const updated = await this.userModel
      .findByIdAndUpdate(id, updates, { new: true })
      .exec();

    if (!updated) {
      throw new NotFoundException('User not found');
    }

    return this.sanitize(updated);
  }

  async remove(id: string) {
    const removed = await this.userModel.findByIdAndDelete(id).exec();
    if (!removed) {
      throw new NotFoundException('User not found');
    }
    return this.sanitize(removed);
  }

  sanitize(user: UserDocument | Record<string, any>): SafeUser {
    const obj =
      'toObject' in user && typeof user.toObject === 'function'
        ? user.toObject()
        : user;
    const { password, __v, _id, isAdmin = false, ...rest } = obj as {
      password?: string;
      __v?: number;
      _id?: string;
      isAdmin?: boolean;
    };
    return {
      id: _id?.toString?.() ?? _id ?? '',
      isAdmin: Boolean(isAdmin),
      ...rest,
    } as SafeUser;
  }
}
